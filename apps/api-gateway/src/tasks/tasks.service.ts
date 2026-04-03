import { ConflictException, Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { TaskStatus, canTransitionStatus } from "../common/task-status";
import { SharedSupabaseService } from "../shared/supabase/supabase.service";
import { TasksRepository } from "./tasks.repository";
import { TaskRecord } from "./task.types";

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
    private readonly supabaseService: SharedSupabaseService,
  ) {}

  async createTaskFromUpload(input: CreateTaskInput) {
    const jobId = crypto.randomUUID();
    const fileHash = crypto
      .createHash("sha256")
      .update(input.file.buffer)
      .digest("hex");
    const fileExtension = this.resolveFileExtension(input.file.mimetype);
    const fileName = `${fileHash}.${fileExtension}`;

    const existingFiles = await this.supabaseService.findFile(fileName);

    if (!existingFiles.length) {
      await this.supabaseService.uploadFile(
        fileName,
        input.file.buffer,
        input.file.mimetype || "image/png",
      );
    }

    const imageUrl = this.supabaseService.getPublicUrl(fileName);
    const now = new Date().toISOString();
    const task: TaskRecord = {
      job_id: jobId,
      session_id: input.sessionId,
      image_url: imageUrl,
      status: TaskStatus.Queued,
      question: input.question?.trim() || null,
      created_at: now,
      updated_at: now,
    };

    await this.repository.createTask(task);
    this.logger.log(`Created task ${jobId} for session ${input.sessionId}`);

    return task;
  }

  async getTask(jobId: string) {
    return this.repository.getTask(jobId);
  }

  async setSegmentationProcessing(jobId: string) {
    return this.transition(jobId, TaskStatus.ProcessingSegmentation);
  }

  async setSegmentationSuccess(jobId: string, maskAllOverlay?: string | null) {
    return this.transition(jobId, TaskStatus.SuccessSegmentation, {
      mask_all_overlay: maskAllOverlay || null,
      segmentation_callback_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    });
  }

  async setVlmProcessing(jobId: string, question?: string) {
    return this.transition(jobId, TaskStatus.ProcessingVlm, {
      question: question?.trim() || null,
      error_code: null,
      error_message: null,
    });
  }

  async setVlmSuccess(jobId: string, reply: string, sessionId: string) {
    return this.transition(jobId, TaskStatus.SuccessVlm, {
      vlm_analysis: reply,
      session_id: sessionId,
      vlm_callback_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    });
  }

  async setError(jobId: string, errorCode: string, errorMessage: string) {
    const task = await this.repository.getTask(jobId);

    if (task.status === TaskStatus.Error) {
      return this.repository.updateTask(jobId, {
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
    patch: Partial<TaskRecord> = {},
  ) {
    const task = await this.repository.getTask(jobId);

    if (task.status === nextStatus) {
      return task;
    }

    if (!canTransitionStatus(task.status, nextStatus)) {
      throw new ConflictException(
        `Invalid task transition ${task.status} -> ${nextStatus} for ${jobId}`,
      );
    }

    return this.repository.updateTask(jobId, {
      ...patch,
      status: nextStatus,
    });
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
