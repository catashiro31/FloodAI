import { TaskStatus } from "../common/task-status";
import { ConversationService } from "../conversation/conversation.service";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { CreateChatDto } from "./dto/create-chat.dto";
import { SegmentationCallbackDto } from "./dto/segmentation-callback.dto";
import { UploadChatDto } from "./dto/upload-chat.dto";
import { VlmCallbackDto } from "./dto/vlm-callback.dto";
export declare class ChatService {
    private readonly tasksService;
    private readonly conversationService;
    private readonly orchestrationService;
    private readonly realtimeService;
    private readonly logger;
    constructor(tasksService: TasksService, conversationService: ConversationService, orchestrationService: OrchestrationService, realtimeService: RealtimeService);
    handleHttpMessage(createChatDto: CreateChatDto): Promise<{
        queued: boolean;
        jobId: string;
        reply: string;
        imageUrls: any[];
    } | {
        reply: string;
        imageUrls: any[];
        queued?: undefined;
        jobId?: undefined;
    }>;
    handleRealtimeMessage(createChatDto: CreateChatDto, clientId: string): Promise<{
        queued: boolean;
        jobId: string;
        reply: string;
        imageUrls: any[];
    } | {
        reply: string;
        imageUrls: any[];
        queued?: undefined;
        jobId?: undefined;
    }>;
    handleUpload(file: Express.Multer.File, body: UploadChatDto, clientId?: string, sessionId?: string): Promise<{
        jobId: string;
        sessionId: string;
        status: TaskStatus;
        imageUrl: string;
    }>;
    handleSegmentationWebhook(body: SegmentationCallbackDto): Promise<{
        status: string;
    }>;
    handleVlmWebhook(body: VlmCallbackDto): Promise<{
        status: string;
    }>;
    getStatus(jobId: string): Promise<{
        jobId: string;
        sessionId: string;
        status: TaskStatus;
        imageUrl: string;
        maskAllOverlay: string;
        reply: string;
        errorCode: string;
        errorMessage: string;
        updatedAt: Date;
        session: import("../tasks/entities/session.entity").Session;
    }>;
    getSessionById(sessionId: string): Promise<import("../tasks/entities/session.entity").Session>;
    getSessions(limit?: number): Promise<{
        sessionId: string;
        lastQuestion: string;
        lastReply: string;
        updatedAt: Date;
        createdAt: Date;
        historyCount: number;
    }[]>;
    getHealth(): {
        status: string;
        message: string;
    };
    private handleMessage;
}
