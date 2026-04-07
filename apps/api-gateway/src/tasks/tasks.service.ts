import { ConflictException, Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { TaskStatus, canTransitionStatus } from "../common/task-status";
import { CloudinaryService } from "../shared/storage/cloudinary.service";
import { TasksRepository } from "./tasks.repository";
import { Task } from "./entities/task.entity";

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
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async createTaskFromUpload(input: CreateTaskInput) {
    const jobId = crypto.randomUUID();
    const fileHash = crypto
      .createHash("sha256")
      .update(input.file.buffer)
      .digest("hex");
    const fileExtension = this.resolveFileExtension(input.file.mimetype);
    const fileName = `${fileHash}.${fileExtension}`;

    // Search for existing file on Cloudinary
    const existingFiles = await this.cloudinaryService.findFile(fileName);
    
    let imageUrl: string;
    if (existingFiles.length > 0) {
      imageUrl = existingFiles[0].secure_url;
    } else {
      const uploadResult = await this.cloudinaryService.uploadFile(input.file.buffer, fileName);
      imageUrl = uploadResult.secure_url;
    }

    const task: Partial<Task> = {
      job_id: jobId,
      session_id: input.sessionId,
      image_url: imageUrl,
      status: TaskStatus.Queued,
      question: input.question?.trim() || null,
    };

    const savedTask = await this.repository.createTask(task);
    this.logger.log(`Created task ${jobId} for session ${input.sessionId}`);

    return savedTask;
  }

  async getTask(jobId: string) {
    return this.repository.getTask(jobId);
  }

  async getTasksBySession(sessionId: string) {
    return this.repository.getTasksBySession(sessionId);
  }

  async setSegmentationProcessing(jobId: string) {
    return this.transition(jobId, TaskStatus.ProcessingSegmentation);
  }

  async setSegmentationSuccess(jobId: string, maskAllOverlay?: string | null, metrics?: Record<string, any>) {
    return this.transition(jobId, TaskStatus.SuccessSegmentation, {
      mask_all_overlay: maskAllOverlay || null,
      metrics: metrics || null,
      segmentation_callback_at: new Date(),
    });
  }

  async setVlmProcessing(jobId: string, question?: string) {
    return this.transition(jobId, TaskStatus.ProcessingVlm, {
      question: question?.trim() || null,
    });
  }

  async setVlmSuccess(jobId: string, reply: string, sessionId: string) {
    return this.transition(jobId, TaskStatus.SuccessVlm, {
      vlm_analysis: reply,
      session_id: sessionId,
      vlm_callback_at: new Date(),
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
    patch: Partial<Task> = {},
  ) {
    const task = await this.getTask(jobId);

    if (task.status === nextStatus) {
      return task;
    }

    // Since canTransitionStatus might expect the old string status, we might need a cast if the types differ slightly
    // but here we are using the TaskStatus enum which should be compatible.
    if (!canTransitionStatus(task.status as any, nextStatus as any)) {
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
