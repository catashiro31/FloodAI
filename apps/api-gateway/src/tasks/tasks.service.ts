import { ConflictException, Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { TaskStatus, canTransitionStatus } from "../common/task-status";
import { SharedStorageService } from "../shared/storage/storage.service";
import { ImageTaskRecord, ReasoningTaskRecord, TaskRecord } from "./task.types";
import { TasksRepository } from "./tasks.repository";

interface CreateTaskInput {
  file: Express.Multer.File;
  sessionId: string;
  question?: string;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly repository: TasksRepository,
    private readonly storageService: SharedStorageService,
  ) {}

  async createTaskFromUpload(input: CreateTaskInput) {
    const existingImageTask = await this.repository.getLatestImageTaskBySession(
      input.sessionId,
    );
    if (existingImageTask) {
      throw new ConflictException(
        `Session ${input.sessionId} already has an uploaded image`,
      );
    }

    const jobId = crypto.randomUUID();
    const fileHash = crypto
      .createHash("sha256")
      .update(input.file.buffer)
      .digest("hex");
    const fileExtension = this.resolveFileExtension(input.file.mimetype);
    const fileName = `${fileHash}.${fileExtension}`;

    const existingFiles = await this.storageService.findFile(fileName);
    const filePath = this.storageService.buildStoragePath(fileName);

    let imageUrl: string;
    if (existingFiles.length > 0) {
      imageUrl = this.storageService.getPublicUrl(filePath);
    } else {
      imageUrl = await this.storageService.ensureFile(
        filePath,
        input.file.buffer,
        input.file.mimetype,
      );
    }

    await this.repository.createReasoningTask({
      job_id: jobId,
      session_id: input.sessionId,
      status: TaskStatus.Queued,
      question: input.question?.trim() || null,
      image_url: imageUrl,
      mask_url: null,
      vlm_analysis: null,
      error_code: null,
      error_message: null,
      vlm_callback_at: null,
    });

    await this.repository.upsertImageTask({
      session_id: input.sessionId,
      image_url: imageUrl,
      status: TaskStatus.Queued,
      mask_url: null,
      metrics: null,
      error_code: null,
      error_message: null,
      segmentation_callback_at: null,
    });

    const savedTask = await this.getTask(jobId);
    this.logger.log(
      `Created reasoning task ${jobId} for session ${input.sessionId}`,
    );

    return savedTask;
  }

  async createReasoningTask(sessionId: string, question: string) {
    const imageTask =
      await this.repository.getLatestImageTaskBySession(sessionId);
    if (!imageTask) {
      throw new ConflictException(
        `Session ${sessionId} does not have an uploaded image`,
      );
    }

    const jobId = crypto.randomUUID();

    await this.repository.createReasoningTask({
      job_id: jobId,
      session_id: sessionId,
      status: TaskStatus.Queued,
      question: question.trim(),
      image_url: imageTask.image_url,
      mask_url: imageTask.mask_url ?? null,
      vlm_analysis: null,
      error_code: null,
      error_message: null,
      vlm_callback_at: null,
    });

    return this.getTask(jobId);
  }

  async getTask(jobId: string) {
    const reasoningTask = await this.repository.getReasoningTask(jobId);
    const imageTask = await this.repository.getLatestImageTaskBySession(
      reasoningTask.session_id,
    );
    return this.hydrateTask(reasoningTask, imageTask);
  }

  async getTasksBySession(sessionId: string) {
    const [reasoningTasks, imageTask] = await Promise.all([
      this.repository.listReasoningTasksBySession(sessionId),
      this.repository.getLatestImageTaskBySession(sessionId),
    ]);

    return reasoningTasks.map((reasoningTask) =>
      this.hydrateTask(reasoningTask, imageTask),
    );
  }

  async getSessionImageTask(sessionId: string) {
    return this.repository.getLatestImageTaskBySession(sessionId);
  }

  async getActiveSegmentationTask(sessionId: string) {
    const processingTask =
      await this.repository.getLatestReasoningTaskByStatuses(sessionId, [
        TaskStatus.ProcessingSegmentation,
      ]);
    if (processingTask) {
      return processingTask;
    }

    return this.repository.getLatestReasoningTaskByStatuses(sessionId, [
      TaskStatus.Queued,
    ]);
  }

  async setSegmentationProcessing(jobId: string) {
    const task = await this.repository.getReasoningTask(jobId);

    await this.repository.updateImageTask(task.session_id, {
      status: TaskStatus.ProcessingSegmentation,
      error_code: null,
      error_message: null,
    });

    return this.transition(jobId, TaskStatus.ProcessingSegmentation, {
      error_code: null,
      error_message: null,
    });
  }

  async setSegmentationSuccess(
    jobId: string,
    maskAllOverlay?: string | null,
    metrics?: Record<string, any>,
  ) {
    const task = await this.repository.getReasoningTask(jobId);

    await this.repository.updateImageTask(task.session_id, {
      status: TaskStatus.SuccessSegmentation,
      mask_url: maskAllOverlay || null,
      metrics: metrics || null,
      error_code: null,
      error_message: null,
      segmentation_callback_at: new Date(),
    });

    return this.transition(jobId, TaskStatus.SuccessSegmentation, {
      mask_url: maskAllOverlay || null,
      error_code: null,
      error_message: null,
    });
  }

  async setVlmProcessing(jobId: string, question?: string) {
    return this.transition(jobId, TaskStatus.ProcessingVlm, {
      question: question?.trim() || null,
    });
  }

  async setVlmSuccess(jobId: string, reply: string) {
    return this.transition(jobId, TaskStatus.SuccessVlm, {
      vlm_analysis: reply,
      vlm_callback_at: new Date(),
    });
  }

  async setError(jobId: string, errorCode: string, errorMessage: string) {
    const task = await this.repository.getReasoningTask(jobId);

    if (task.status === TaskStatus.Error) {
      await this.repository.updateReasoningTask(jobId, {
        error_code: errorCode,
        error_message: errorMessage,
      });
      return this.getTask(jobId);
    }

    if (
      task.status === TaskStatus.Queued ||
      task.status === TaskStatus.ProcessingSegmentation
    ) {
      await this.repository.updateImageTask(task.session_id, {
        status: TaskStatus.Error,
        error_code: errorCode,
        error_message: errorMessage,
      });
    }

    return this.transition(jobId, TaskStatus.Error, {
      error_code: errorCode,
      error_message: errorMessage,
    });
  }

  private async transition(
    jobId: string,
    nextStatus: TaskStatus,
    patch: Partial<ReasoningTaskRecord> = {},
  ) {
    const task = await this.repository.getReasoningTask(jobId);

    if (task.status === nextStatus) {
      return this.getTask(jobId);
    }

    if (!canTransitionStatus(task.status as TaskStatus, nextStatus)) {
      throw new ConflictException(
        `Invalid task transition ${task.status} -> ${nextStatus} for ${jobId}`,
      );
    }

    await this.repository.updateReasoningTask(jobId, {
      ...patch,
      status: nextStatus,
    });

    return this.getTask(jobId);
  }

  private hydrateTask(
    reasoningTask: ReasoningTaskRecord,
    imageTask?: ImageTaskRecord | null,
  ): TaskRecord {
    const maskUrl = reasoningTask.mask_url ?? imageTask?.mask_url ?? null;

    return {
      ...reasoningTask,
      image_url: reasoningTask.image_url ?? imageTask?.image_url ?? null,
      mask_url: maskUrl,
      mask_all_overlay: maskUrl,
      metrics: imageTask?.metrics ?? null,
      image_status: imageTask?.status ?? null,
      segmentation_callback_at: imageTask?.segmentation_callback_at ?? null,
    };
  }

  private resolveFileExtension(mimeType?: string) {
    switch (mimeType) {
      case "image/png":
        return "png";
      case "image/jpeg":
        return "jpg";
      case "image/webp":
        return "webp";
      default:
        return "bin";
    }
  }
}
