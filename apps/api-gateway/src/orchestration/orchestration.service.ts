import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { TaskRecord } from "../tasks/task.types";
import { SegmentationClient } from "./segmentation.client";
import { VlmClient } from "./vlm.client";
import { VlmService } from "../vlm/vlm.service";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly tasksService: TasksService,
    private readonly realtimeService: RealtimeService,
    private readonly segmentationClient: SegmentationClient,
    private readonly vlmClient: VlmClient,
    private readonly vlmService: VlmService,
  ) { }

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
        task.job_id,
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

      // Kiểm tra cấu hình để quyết định chạy Local hay Remote
      const useLocalVlm = this.configService.get<string>("USE_LOCAL_VLM") === "true";

      if (useLocalVlm) {
        this.logger.log(`Running Local VLM for ${task.job_id} using Ollama`);
        void this.runLocalVlm(task, question, clientId);
      } else {
        await this.vlmClient.trigger(
          task.job_id,
          task.session_id,
          question,
          this.buildCallbackUrl("/chat/webhook/vlm"),
          reset,
        );
      }
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

  private async getBufferFromUrl(url: string): Promise<Buffer> {
    if (!url) throw new Error("URL is empty");

    // Nếu là đường dẫn cục bộ /static/...
    if (url.startsWith("/static/")) {
      const fileName = url.replace(/^\/static\//, "");
      const filePath = path.resolve(process.cwd(), "uploads", fileName);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
      throw new Error(`File not found at ${filePath}`);
    }

    // Nếu là URL đầy đủ (http/https)
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
  }

  private async runLocalVlm(task: TaskRecord, question: string, clientId?: string) {
    try {
      // Tải ảnh gốc
      if (!task.image_url) throw new Error("No original image found for VLM analysis");
      const originalBuffer = await this.getBufferFromUrl(task.image_url);
      const base64Original = originalBuffer.toString('base64');

      // Tải ảnh mask (nếu có)
      let base64Mask: string | null = null;
      if (task.mask_all_overlay) {
        try {
          const maskBuffer = await this.getBufferFromUrl(task.mask_all_overlay);
          base64Mask = maskBuffer.toString('base64');
        } catch (err) {
          this.logger.warn(`Could not load mask image: ${err.message}`);
        }
      }

      let reply: string;
      if (base64Mask) {
        // Dual-VLM Expert Analysis: PaliGemma + Gemma4
        this.logger.log(`Running Dual-VLM Expert for ${task.job_id}`);
        reply = await this.vlmService.analyzeExpert(
          question,
          base64Original,
          base64Mask,
          task.metrics || null,
        );
      } else {
        // Fallback: chỉ dùng Gemma4 với ảnh gốc
        this.logger.log(`Running Gemma4 fallback for ${task.job_id}`);
        reply = await this.vlmService.analyze(question, base64Original, 'gemma4');
      }

      await axios.post(this.buildCallbackUrl("/chat/webhook/vlm"), {
        job_id: task.job_id,
        session_id: task.session_id,
        status: "success_vlm",
        reply: reply,
      });

    } catch (error) {
      this.logger.error(`Local VLM execution failed: ${error.message}`);
      await axios.post(this.buildCallbackUrl("/chat/webhook/vlm"), {
        job_id: task.job_id,
        status: "error",
        error_message: error.message,
      });
    }
  }


  private buildCallbackUrl(pathname: string) {
    const baseUrl =
      this.configService.get<string>("GATEWAY_BASE_URL") ||
      "http://localhost:5000";

    return `${baseUrl}${pathname}`;
  }
}
