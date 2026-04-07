import { ChatService } from "./chat.service";
import { CreateChatDto } from "./dto/create-chat.dto";
import { SegmentationCallbackDto } from "./dto/segmentation-callback.dto";
import { UploadChatDto } from "./dto/upload-chat.dto";
import { VlmCallbackDto } from "./dto/vlm-callback.dto";
export declare class ChatController {
    private readonly chatService;
    constructor(chatService: ChatService);
    sendMessage(createChatDto: CreateChatDto): Promise<{
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
    sendFollowUp(createChatDto: CreateChatDto): Promise<{
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
    uploadFile(file: Express.Multer.File, body: UploadChatDto, clientId?: string, sessionId?: string): Promise<{
        jobId: string;
        sessionId: string;
        status: import("../common/task-status").TaskStatus;
        imageUrl: string;
    }>;
    segmentationWebhook(body: SegmentationCallbackDto): Promise<{
        status: string;
    }>;
    vlmWebhook(body: VlmCallbackDto): Promise<{
        status: string;
    }>;
    getStatus(jobId: string): Promise<{
        jobId: string;
        sessionId: string;
        status: import("../common/task-status").TaskStatus;
        imageUrl: string;
        maskAllOverlay: string;
        reply: string;
        errorCode: string;
        errorMessage: string;
        updatedAt: Date;
        session: import("../tasks/entities/session.entity").Session;
    }>;
    getSessions(limit?: string): Promise<{
        sessions: {
            sessionId: string;
            lastQuestion: string;
            lastReply: string;
            updatedAt: Date;
            createdAt: Date;
            historyCount: number;
        }[];
    }>;
    getSessionById(sessionId: string): Promise<{
        session: import("../tasks/entities/session.entity").Session;
    }>;
    healthCheck(): {
        status: string;
        message: string;
    };
}
