import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { TaskRecord } from "../tasks/task.types";
import { SegmentationClient } from "./segmentation.client";
import { VlmClient } from "./vlm.client";

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly tasksService: TasksService,
    private readonly realtimeService: RealtimeService,
    private readonly segmentationClient: SegmentationClient,
    private readonly vlmClient: VlmClient,
  ) {}

  triggerSegmentation(task: TaskRecord, clientId?: string) {
    void this.enqueueSegmentation(task, clientId);
  }

  async enqueueSegmentation(task: TaskRecord, clientId?: string) {
    try {
      await this.tasksService.setSegmentationProcessing(task.job_id);
      this.realtimeService.sendStatus(
        clientId,
        "Processing segmentation",
        {
          jobId: task.job_id,
        },
        task.session_id,
      );

      await this.segmentationClient.trigger(
        task.session_id,
        this.buildCallbackUrl("/chat/webhook/segmentation"),
        this.buildCallbackUrl("/chat/webhook/progress"),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown segmentation error";
      this.logger.error(`Failed to enqueue segmentation: ${message}`);
      await this.tasksService.setError(
        task.job_id,
        "SEGMENTATION_ENQUEUE_FAILED",
        message,
      );
      this.realtimeService.sendStatus(
        clientId,
        "Segmentation Error",
        {
          jobId: task.job_id,
          error: message,
        },
        task.session_id,
      );
    }
  }

  async enqueueVlm(
    task: TaskRecord,
    question: string,
    reset = false,
    clientId?: string,
  ) {
    try {
      await this.tasksService.setVlmProcessing(task.job_id, question);
      this.realtimeService.sendStatus(
        clientId,
        "Processing VLM reasoning",
        {
          jobId: task.job_id,
        },
        task.session_id,
      );

      await this.vlmClient.trigger(
        task.job_id,
        task.session_id,
        question,
        this.buildCallbackUrl("/chat/webhook/vlm"),
        reset,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown VLM error";
      this.logger.error(`Failed to enqueue VLM: ${message}`);
      await this.tasksService.setError(
        task.job_id,
        "VLM_ENQUEUE_FAILED",
        message,
      );
      this.realtimeService.sendStatus(
        clientId,
        "VLM Error",
        {
          jobId: task.job_id,
          error: message,
        },
        task.session_id,
      );
    }
  }

  private buildCallbackUrl(pathname: string) {
    const baseUrl =
      this.configService.get<string>("GATEWAY_BASE_URL") ||
      "http://localhost:5000";
    const webhookSecret =
      this.configService.get<string>("WORKER_WEBHOOK_SECRET") ||
      this.configService.get<string>("WEBHOOK_SECRET");

    const callbackUrl = new URL(`${baseUrl}${pathname}`);
    if (webhookSecret) {
      callbackUrl.searchParams.set("token", webhookSecret);
    }

    return callbackUrl.toString();
  }
}
