import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { TaskStatus } from "../common/task-status";
import { ConversationService } from "../conversation/conversation.service";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { CreateChatDto } from "./dto/create-chat.dto";
import { SegmentationCallbackDto } from "./dto/segmentation-callback.dto";
import { UploadChatDto } from "./dto/upload-chat.dto";
import { VlmCallbackDto } from "./dto/vlm-callback.dto";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly conversationService: ConversationService,
    private readonly orchestrationService: OrchestrationService,
    private readonly realtimeService: RealtimeService,
  ) { }

  async handleHttpMessage(createChatDto: CreateChatDto) {
    return this.handleMessage(createChatDto);
  }

  async handleRealtimeMessage(createChatDto: CreateChatDto, clientId: string) {
    return this.handleMessage(createChatDto, clientId);
  }

  async handleUpload(
    file: Express.Multer.File,
    body: UploadChatDto,
    clientId?: string,
    sessionId?: string,
  ) {
    if (!file) {
      throw new BadRequestException("file is required");
    }

    const effectiveSessionId =
      sessionId || body.sessionId || crypto.randomUUID();

    // Tạo session trước để thỏa mãn ràng buộc khóa ngoại (không kèm câu hỏi để tránh lặp)
    await this.conversationService.ensureSession(effectiveSessionId);

    const task = await this.tasksService.createTaskFromUpload({
      file,
      sessionId: effectiveSessionId,
      question: body.question,
    });

    // Ghi lại tin nhắn của người dùng kèm với ảnh đã được upload thành công
    await this.conversationService.recordUserMessage(
      effectiveSessionId,
      task.job_id,
      body.question || "Phân tích ảnh này",
      false,
      [task.image_url],
    );
    this.realtimeService.registerSessionClient(effectiveSessionId, clientId);
    this.realtimeService.registerTaskClient(task.job_id, clientId);
    this.realtimeService.registerTaskSession(task.job_id, effectiveSessionId);
    this.realtimeService.sendStatus(
      clientId,
      "Task queued",
      {
        jobId: task.job_id,
        sessionId: effectiveSessionId,
      },
      effectiveSessionId,
    );
    this.orchestrationService.triggerSegmentation(task, clientId);

    return {
      jobId: task.job_id,
      sessionId: effectiveSessionId,
      status: TaskStatus.Queued,
      imageUrl: task.image_url,
    };
  }

  async handleSegmentationWebhook(body: SegmentationCallbackDto) {
    const existingTask = await this.tasksService.getTask(body.job_id);
    const clientId = this.realtimeService.getClientIdForTask(body.job_id);
    const sessionId =
      existingTask.session_id ||
      this.realtimeService.getSessionIdForTask(body.job_id);

    if (body.status === TaskStatus.Error) {
      if (existingTask.status === TaskStatus.SuccessVlm) {
        return { status: "duplicate-ignored" };
      }

      await this.tasksService.setError(
        body.job_id,
        body.error_code || "SEGMENTATION_FAILED",
        body.error_message || "Segmentation failed",
      );
      this.realtimeService.sendStatus(
        clientId,
        "Segmentation Error",
        {
          jobId: body.job_id,
          error: body.error_message || "Segmentation failed",
        },
        sessionId,
      );
      return { status: "ok" };
    }

    if (
      existingTask.status === TaskStatus.ProcessingVlm ||
      existingTask.status === TaskStatus.SuccessVlm
    ) {
      return { status: "duplicate-ignored" };
    }

    const task = await this.tasksService.setSegmentationSuccess(
      body.job_id,
      body.mask_all_overlay || body.mask_url || null,
      body.metrics || null,
    );
    this.realtimeService.registerTaskSession(task.job_id, task.session_id);

    this.realtimeService.sendStatus(
      clientId,
      "Segmentation complete",
      {
        jobId: body.job_id,
        maskAllOverlay: task.mask_all_overlay,
        metrics: task.metrics || null,
      },
      task.session_id,
    );

    await this.orchestrationService.enqueueVlm(
      task,
      task.question || "Hãy phân tích tình trạng ngập lụt của bức ảnh này và tóm tắt nguy cơ do lụt gây ra.",
      false,
      clientId,
    );

    return { status: "ok" };
  }

  async handleProgressWebhook(body: any) {
    const { job_id, progress, est_seconds_remaining } = body;
    const clientId = this.realtimeService.getClientIdForTask(job_id);
    const sessionId = this.realtimeService.getSessionIdForTask(job_id);

    // Gửi cập nhật tiến độ theo thời gian thực cho frontend
    this.realtimeService.sendStatus(
      clientId,
      "Processing segmentation",
      {
        jobId: job_id,
        progress: progress || 0,
        estSecondsRemaining: est_seconds_remaining || 0,
      },
      sessionId,
    );

    return { status: "ok" };
  }

  async handleVlmWebhook(body: VlmCallbackDto) {
    const existingTask = await this.tasksService.getTask(body.job_id);
    const clientId = this.realtimeService.getClientIdForTask(body.job_id);
    const sessionId =
      body.session_id ||
      existingTask.session_id ||
      this.realtimeService.getSessionIdForTask(body.job_id);

    if (body.status === TaskStatus.Error) {
      if (existingTask.status === TaskStatus.SuccessVlm) {
        return { status: "duplicate-ignored" };
      }

      await this.tasksService.setError(
        body.job_id,
        body.error_code || "VLM_FAILED",
        body.error_message || "VLM failed",
      );
      this.realtimeService.sendStatus(
        clientId,
        "VLM Error",
        {
          jobId: body.job_id,
          error: body.error_message || "VLM failed",
        },
        sessionId,
      );
      return { status: "ok" };
    }

    const reply = body.reply || "";
    if (
      existingTask.status === TaskStatus.SuccessVlm &&
      existingTask.vlm_analysis === reply
    ) {
      this.realtimeService.sendReply(
        clientId,
        {
          reply,
          jobId: existingTask.job_id,
          imageUrls: existingTask.mask_all_overlay
            ? [existingTask.mask_all_overlay]
            : [],
        },
        sessionId,
      );
      this.realtimeService.sendStatus(
        clientId,
        "Task Completed",
        {
          jobId: existingTask.job_id,
        },
        sessionId,
      );
      return { status: "replayed" };
    }

    const task = await this.tasksService.setVlmSuccess(
      body.job_id,
      reply,
      body.session_id,
    );

    this.logger.log(`Recording assistant response for session ${body.session_id}, task ${task.job_id}`);

    // Không đính kèm mask vào tin nhắn chat để tránh loãng nội dung, người dùng có thể xem ở panel phải
    const assistantImageUrls = [];

    await this.conversationService.recordAssistantResponse(
      body.session_id,
      task.job_id,
      reply,
      body.context,
      body.history,
      assistantImageUrls,
    );

    this.realtimeService.sendReply(
      clientId,
      {
        reply,
        jobId: task.job_id,
        imageUrls: assistantImageUrls,
        createdAt: new Date().toISOString(),
      },
      body.session_id || sessionId,
    );


    return { status: "ok" };
  }

  async getStatus(jobId: string) {
    const task = await this.tasksService.getTask(jobId);
    const session = await this.conversationService.getSession(task.session_id);

    return {
      jobId: task.job_id,
      sessionId: task.session_id,
      status: task.status,
      imageUrl: task.image_url,
      maskAllOverlay: task.mask_all_overlay,
      reply: task.vlm_analysis,
      errorCode: task.error_code,
      errorMessage: task.error_message,
      updatedAt: task.updated_at,
      metrics: task.metrics || null,
      session,
    };
  }

  async getTasksBySession(sessionId: string) {
    const tasks = await this.tasksService.getTasksBySession(sessionId);
    return tasks.map((task) => ({
      jobId: task.job_id,
      sessionId: task.session_id,
      imageUrl: task.image_url,
      maskAllOverlay: task.mask_all_overlay,
      metrics: task.metrics || null,
      status: task.status,
      createdAt: task.created_at,
    }));
  }

  async getSessionById(sessionId: string) {
    const session = await this.conversationService.getSession(sessionId);
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    return session;
  }

  async getSessions(limit = 50) {
    const sessions = await this.conversationService.listSessions(limit);
    return sessions.map((session) => ({
      sessionId: session.session_id,
      lastQuestion: session.last_question || null,
      lastReply: session.last_reply || null,
      updatedAt: session.updated_at || null,
      createdAt: session.created_at || null,
      historyCount: Array.isArray(session.history) ? session.history.length : 0,
    }));
  }

  getHealth() {
    return {
      status: "ok",
      message: "Gateway is running",
    };
  }

  private async handleMessage(createChatDto: CreateChatDto, clientId?: string) {
    const trimmedMessage = createChatDto.message?.trim();

    if (!trimmedMessage) {
      throw new BadRequestException("message is required");
    }

    if (createChatDto.jobId && createChatDto.sessionId) {
      const task = await this.tasksService.getTask(createChatDto.jobId);

      await this.conversationService.recordUserMessage(
        createChatDto.sessionId,
        createChatDto.jobId,
        trimmedMessage,
        createChatDto.reset,
      );

      this.realtimeService.registerSessionClient(
        createChatDto.sessionId,
        clientId,
      );
      this.realtimeService.registerTaskClient(task.job_id, clientId);
      this.realtimeService.registerTaskSession(
        task.job_id,
        createChatDto.sessionId,
      );
      await this.orchestrationService.enqueueVlm(
        task,
        trimmedMessage,
        createChatDto.reset,
        clientId,
      );

      return {
        queued: true,
        jobId: task.job_id,
        reply: "⏳ Đang truy vấn mô hình chuyên gia...",
        imageUrls: [],
      };
    }

    this.logger.log(`Fallback message flow for: ${trimmedMessage}`);

    if (/^(xin chào|hello|hi)\b/i.test(trimmedMessage)) {
      return {
        reply:
          "Xin chào! Hãy tải ảnh hoặc gửi kèm jobId/sessionId để tiếp tục phân tích.",
        imageUrls: [],
      };
    }

    return {
      reply:
        "Backend gateway đã hỗ trợ follow-up theo session. Hãy gửi kèm jobId và sessionId hoặc upload ảnh mới để bắt đầu pipeline.",
      imageUrls: [],
    };
  }
}
