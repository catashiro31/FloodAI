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
  private static readonly ALLOWED_UPLOAD_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);

  constructor(
    private readonly tasksService: TasksService,
    private readonly conversationService: ConversationService,
    private readonly orchestrationService: OrchestrationService,
    private readonly realtimeService: RealtimeService,
  ) {}

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
    this.assertValidUpload(file);

    const effectiveSessionId =
      sessionId || body.sessionId || crypto.randomUUID();

    // Tạo session trước để thỏa mãn ràng buộc khóa ngoại (không kèm câu hỏi để tránh lặp)
    await this.conversationService.ensureSession(effectiveSessionId);

    const task = await this.tasksService.createTaskFromUpload({
      file,
      sessionId: effectiveSessionId,
      question: body.question,
    });
    const uploadedImageUrls = task.image_url ? [task.image_url] : [];

    // Ghi lại tin nhắn của người dùng kèm với ảnh đã được upload thành công
    await this.conversationService.recordUserMessage(
      effectiveSessionId,
      task.job_id,
      body.question || "Phân tích ảnh này",
      false,
      uploadedImageUrls,
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
      reasoningTaskId: task.job_id,
      sessionId: effectiveSessionId,
      status: TaskStatus.Queued,
      imageUrl: task.image_url,
    };
  }

  async handleSegmentationWebhook(body: SegmentationCallbackDto) {
    const existingTask = await this.tasksService.getActiveSegmentationTask(
      body.session_id,
    );
    const clientId = existingTask
      ? this.realtimeService.getClientIdForTask(existingTask.job_id)
      : undefined;
    const sessionId = body.session_id;

    if (body.status === TaskStatus.Error) {
      if (!existingTask) {
        return { status: "duplicate-ignored" };
      }

      if (existingTask.status === TaskStatus.SuccessVlm) {
        return { status: "duplicate-ignored" };
      }

      await this.tasksService.setError(
        existingTask.job_id,
        body.error_code || "SEGMENTATION_FAILED",
        body.error_message || "Segmentation failed",
      );
      this.realtimeService.sendStatus(
        clientId,
        "Segmentation Error",
        {
          jobId: existingTask.job_id,
          error: body.error_message || "Segmentation failed",
        },
        sessionId,
      );
      return { status: "ok" };
    }

    if (!existingTask) {
      return { status: "duplicate-ignored" };
    }

    if (
      existingTask.status === TaskStatus.ProcessingVlm ||
      existingTask.status === TaskStatus.SuccessVlm
    ) {
      return { status: "duplicate-ignored" };
    }

    const task = await this.tasksService.setSegmentationSuccess(
      existingTask.job_id,
      body.mask_all_overlay || body.mask_url || null,
      body.metrics || null,
    );
    this.realtimeService.registerTaskSession(task.job_id, task.session_id);

    this.realtimeService.sendStatus(
      clientId,
      "Segmentation complete",
      {
        jobId: task.job_id,
        maskAllOverlay: task.mask_all_overlay,
        metrics: task.metrics || null,
      },
      task.session_id,
    );

    await this.orchestrationService.enqueueVlm(
      task,
      task.question ||
        "Hãy phân tích tình trạng ngập lụt của bức ảnh này và tóm tắt nguy cơ do lụt gây ra.",
      false,
      clientId,
    );

    return { status: "ok" };
  }

  async handleProgressWebhook(body: any) {
    const { session_id, progress, est_seconds_remaining } = body;
    const activeTask =
      await this.tasksService.getActiveSegmentationTask(session_id);
    const clientId = activeTask
      ? this.realtimeService.getClientIdForTask(activeTask.job_id)
      : undefined;
    const sessionId = session_id;

    // Gửi cập nhật tiến độ theo thời gian thực cho frontend
    this.realtimeService.sendStatus(
      clientId,
      "Processing segmentation",
      {
        jobId: activeTask?.job_id,
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
      existingTask.session_id ||
      this.realtimeService.getSessionIdForTask(body.job_id);

    if (body.session_id && body.session_id !== existingTask.session_id) {
      this.logger.warn(
        `Rejected VLM callback session mismatch for ${body.job_id}: expected ${existingTask.session_id}, received ${body.session_id}`,
      );
      throw new BadRequestException("session_id does not match task owner");
    }

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

    const task = await this.tasksService.setVlmSuccess(body.job_id, reply);

    this.logger.log(
      `Recording assistant response for session ${sessionId}, task ${task.job_id}`,
    );

    // Không đính kèm mask vào tin nhắn chat để tránh loãng nội dung, người dùng có thể xem ở panel phải
    const assistantImageUrls = [];

    await this.conversationService.recordAssistantResponse(
      sessionId,
      task.job_id,
      reply,
      body.context,
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
      sessionId,
    );

    return { status: "ok" };
  }

  async getStatus(jobId: string) {
    const task = await this.tasksService.getTask(jobId);
    const session = await this.conversationService.getSession(task.session_id);

    return {
      jobId: task.job_id,
      reasoningTaskId: task.job_id,
      sessionId: task.session_id,
      status: task.status,
      imageUrl: task.image_url,
      imageStatus: task.image_status,
      maskAllOverlay: task.mask_all_overlay,
      reply: task.vlm_analysis,
      errorCode: task.error_code,
      errorMessage: task.error_message,
      updatedAt: task.updated_at,
      metrics: task.metrics || null,
      session: session ? this.serializeSession(session) : null,
    };
  }

  async getTasksBySession(sessionId: string) {
    const tasks = await this.tasksService.getTasksBySession(sessionId);
    return tasks.map((task) => ({
      jobId: task.job_id,
      reasoningTaskId: task.job_id,
      sessionId: task.session_id,
      imageUrl: task.image_url,
      imageStatus: task.image_status,
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
    return this.serializeSession(session);
  }

  async getSessions(limit = 50) {
    const sessions = await this.conversationService.listSessions(limit);
    return sessions.map((session) => ({
      sessionId: session.session_id,
      lastQuestion: session.last_question || null,
      lastReply: session.last_reply || null,
      updatedAt: session.updated_at || null,
      createdAt: session.created_at || null,
      historyCount: session.history_count ?? 0,
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
      const currentTask = await this.tasksService.getTask(createChatDto.jobId);
      if (currentTask.session_id !== createChatDto.sessionId) {
        throw new BadRequestException(
          "jobId does not belong to the provided sessionId",
        );
      }

      const nextTask = await this.tasksService.createReasoningTask(
        createChatDto.sessionId,
        trimmedMessage,
      );

      await this.conversationService.recordUserMessage(
        createChatDto.sessionId,
        nextTask.job_id,
        trimmedMessage,
        createChatDto.reset,
      );

      this.realtimeService.registerSessionClient(
        createChatDto.sessionId,
        clientId,
      );
      this.realtimeService.registerTaskClient(nextTask.job_id, clientId);
      this.realtimeService.registerTaskSession(
        nextTask.job_id,
        createChatDto.sessionId,
      );
      await this.orchestrationService.enqueueVlm(
        nextTask,
        trimmedMessage,
        createChatDto.reset,
        clientId,
      );

      return {
        queued: true,
        jobId: nextTask.job_id,
        reasoningTaskId: nextTask.job_id,
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

  private assertValidUpload(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("file is required");
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException("file must not be empty");
    }

    if (!ChatService.ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("file must be a png, jpeg, or webp image");
    }
  }

  private serializeSession(session: Record<string, any>) {
    return {
      ...session,
      sessionId: session.session_id,
      lastQuestion: session.last_question || null,
      lastReply: session.last_reply || null,
      createdAt: session.created_at || null,
      updatedAt: session.updated_at || null,
      historyCount: session.history_count ?? 0,
      imageTask: session.image_task ?? null,
      reasoningTasks: session.reasoning_tasks ?? [],
      history: (session.history ?? []).map((entry: Record<string, any>) => ({
        ...entry,
        historyId: entry.history_id,
        sessionId: entry.session_id,
        reasoningTaskId: entry.reasoning_task_id ?? null,
        imageUrls: entry.image_urls ?? [],
        createdAt: entry.created_at ?? null,
      })),
    };
  }
}
