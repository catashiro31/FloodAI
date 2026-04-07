import { ConfigService } from "@nestjs/config";
import { RealtimeService } from "../realtime/realtime.service";
import { TasksService } from "../tasks/tasks.service";
import { TaskRecord } from "../tasks/task.types";
import { SegmentationClient } from "./segmentation.client";
import { VlmClient } from "./vlm.client";
export declare class OrchestrationService {
    private readonly configService;
    private readonly tasksService;
    private readonly realtimeService;
    private readonly segmentationClient;
    private readonly vlmClient;
    private readonly logger;
    constructor(configService: ConfigService, tasksService: TasksService, realtimeService: RealtimeService, segmentationClient: SegmentationClient, vlmClient: VlmClient);
    triggerSegmentation(task: TaskRecord, clientId?: string): void;
    enqueueSegmentation(task: TaskRecord, clientId?: string): Promise<void>;
    enqueueVlm(task: TaskRecord, question: string, reset?: boolean, clientId?: string): Promise<void>;
    private buildCallbackUrl;
}
