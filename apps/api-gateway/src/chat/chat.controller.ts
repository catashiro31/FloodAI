import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ChatService } from "./chat.service";
import { CreateChatDto } from "./dto/create-chat.dto";
import { SegmentationCallbackDto } from "./dto/segmentation-callback.dto";
import { UploadChatDto } from "./dto/upload-chat.dto";
import { VlmCallbackDto } from "./dto/vlm-callback.dto";

@Controller("chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async sendMessage(@Body() createChatDto: CreateChatDto) {
    return this.chatService.handleHttpMessage(createChatDto);
  }

  @Post("message")
  async sendFollowUp(@Body() createChatDto: CreateChatDto) {
    return this.chatService.handleHttpMessage(createChatDto);
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadChatDto,
    @Headers("x-client-id") clientId?: string,
    @Headers("x-session-id") sessionId?: string,
  ) {
    return this.chatService.handleUpload(file, body, clientId, sessionId);
  }

  @Post("webhook/segmentation")
  async segmentationWebhook(@Body() body: SegmentationCallbackDto) {
    return this.chatService.handleSegmentationWebhook(body);
  }

  @Post("webhook/progress")
  async progressWebhook(@Body() body: any) {
    return this.chatService.handleProgressWebhook(body);
  }

  @Post("webhook/vlm")
  async vlmWebhook(@Body() body: VlmCallbackDto) {
    return this.chatService.handleVlmWebhook(body);
  }

  @Get("status/:jobId")
  async getStatus(@Param("jobId") jobId: string) {
    return this.chatService.getStatus(jobId);
  }

  @Get("sessions")
  async getSessions(@Query("limit") limit?: string) {
    const parsedLimit = Number(limit);
    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    return {
      sessions: await this.chatService.getSessions(safeLimit),
    };
  }

  @Get("sessions/:sessionId")
  async getSessionById(@Param("sessionId") sessionId: string) {
    return {
      session: await this.chatService.getSessionById(sessionId),
    };
  }

  @Get("tasks/:sessionId")
  async getTasksBySession(@Param("sessionId") sessionId: string) {
    return {
      tasks: await this.chatService.getTasksBySession(sessionId),
    };
  }

  @Get("health")
  healthCheck() {
    return this.chatService.getHealth();
  }
}
