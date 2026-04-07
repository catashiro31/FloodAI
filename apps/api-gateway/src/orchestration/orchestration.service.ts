import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { TaskRecord } from "../tasks/task.types";
import { SegmentationClient } from "./segmentation.client";
import { VlmClient } from "./vlm.client";
import { VlmService } from "../vlm/vlm.service";
import axios from "axios";

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

  private async runLocalVlm(task: TaskRecord, question: string, clientId?: string) {
    try {
      const imageUrl = task.mask_all_overlay || task.image_url;
      if (!imageUrl) throw new Error("No image found for VLM analysis");

      // 1. Download và chuyển đổi sang Base64
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const base64Image = Buffer.from(response.data, 'binary').toString('base64');

      // 2. Định dạng ngữ cảnh đính kèm Metrics
      let prompt = question;
      if (task.metrics) {
        prompt = `Ngữ cảnh nhận diện từ mô hình (tỷ lệ ngập dán nhãn): ${JSON.stringify(task.metrics)}\n\nCâu hỏi: ${question}\nHãy trả lời tự nhiên và ngắn gọn bằng tiếng Việt.`;
      }

      // 3. Chạy Ollama
      const reply = await this.vlmService.analyze(prompt, base64Image);

      // 4. Callback giả lập (Giống cách worker gọi về)
      const { ChatService } = require("../chat/chat.service"); // Late import to avoid circular dependency
      // Tuy nhiên, Orchestration được inject vào ChatService, nên ta có thể gửi message qua realtime trực tiếp 
      // hoặc gọi endpoint webhook qua axios. Để an toàn, ta dùng axios gọi chính mình.
      
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
