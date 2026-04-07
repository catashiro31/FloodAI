"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OrchestrationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestrationService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const realtime_service_1 = require("../realtime/realtime.service");
const tasks_service_1 = require("../tasks/tasks.service");
const segmentation_client_1 = require("./segmentation.client");
const vlm_client_1 = require("./vlm.client");
let OrchestrationService = OrchestrationService_1 = class OrchestrationService {
    constructor(configService, tasksService, realtimeService, segmentationClient, vlmClient) {
        this.configService = configService;
        this.tasksService = tasksService;
        this.realtimeService = realtimeService;
        this.segmentationClient = segmentationClient;
        this.vlmClient = vlmClient;
        this.logger = new common_1.Logger(OrchestrationService_1.name);
    }
    triggerSegmentation(task, clientId) {
        void this.enqueueSegmentation(task, clientId);
    }
    async enqueueSegmentation(task, clientId) {
        try {
            await this.tasksService.setSegmentationProcessing(task.job_id);
            this.realtimeService.sendStatus(clientId, "Processing segmentation", {
                jobId: task.job_id,
            }, task.session_id);
            await this.segmentationClient.trigger(task.job_id, this.buildCallbackUrl("/chat/webhook/segmentation"));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown segmentation error";
            this.logger.error(`Failed to enqueue segmentation: ${message}`);
            await this.tasksService.setError(task.job_id, "SEGMENTATION_ENQUEUE_FAILED", message);
            this.realtimeService.sendStatus(clientId, "Segmentation Error", {
                jobId: task.job_id,
                error: message,
            }, task.session_id);
        }
    }
    async enqueueVlm(task, question, reset = false, clientId) {
        try {
            await this.tasksService.setVlmProcessing(task.job_id, question);
            this.realtimeService.sendStatus(clientId, "Processing VLM reasoning", {
                jobId: task.job_id,
            }, task.session_id);
            await this.vlmClient.trigger(task.job_id, task.session_id, question, this.buildCallbackUrl("/chat/webhook/vlm"), reset);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown VLM error";
            this.logger.error(`Failed to enqueue VLM: ${message}`);
            await this.tasksService.setError(task.job_id, "VLM_ENQUEUE_FAILED", message);
            this.realtimeService.sendStatus(clientId, "VLM Error", {
                jobId: task.job_id,
                error: message,
            }, task.session_id);
        }
    }
    buildCallbackUrl(pathname) {
        const baseUrl = this.configService.get("GATEWAY_BASE_URL") ||
            "http://localhost:5000";
        return `${baseUrl}${pathname}`;
    }
};
exports.OrchestrationService = OrchestrationService;
exports.OrchestrationService = OrchestrationService = OrchestrationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        tasks_service_1.TasksService,
        realtime_service_1.RealtimeService,
        segmentation_client_1.SegmentationClient,
        vlm_client_1.VlmClient])
], OrchestrationService);
//# sourceMappingURL=orchestration.service.js.map