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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const chat_service_1 = require("./chat.service");
const create_chat_dto_1 = require("./dto/create-chat.dto");
const segmentation_callback_dto_1 = require("./dto/segmentation-callback.dto");
const upload_chat_dto_1 = require("./dto/upload-chat.dto");
const vlm_callback_dto_1 = require("./dto/vlm-callback.dto");
let ChatController = class ChatController {
    constructor(chatService) {
        this.chatService = chatService;
    }
    async sendMessage(createChatDto) {
        return this.chatService.handleHttpMessage(createChatDto);
    }
    async sendFollowUp(createChatDto) {
        return this.chatService.handleHttpMessage(createChatDto);
    }
    async uploadFile(file, body, clientId, sessionId) {
        return this.chatService.handleUpload(file, body, clientId, sessionId);
    }
    async segmentationWebhook(body) {
        return this.chatService.handleSegmentationWebhook(body);
    }
    async vlmWebhook(body) {
        return this.chatService.handleVlmWebhook(body);
    }
    async getStatus(jobId) {
        return this.chatService.getStatus(jobId);
    }
    async getSessions(limit) {
        const parsedLimit = Number(limit);
        const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
        return {
            sessions: await this.chatService.getSessions(safeLimit),
        };
    }
    async getSessionById(sessionId) {
        return {
            session: await this.chatService.getSessionById(sessionId),
        };
    }
    healthCheck() {
        return this.chatService.getHealth();
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_chat_dto_1.CreateChatDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "sendMessage", null);
__decorate([
    (0, common_1.Post)("message"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_chat_dto_1.CreateChatDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "sendFollowUp", null);
__decorate([
    (0, common_1.Post)("upload"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file")),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)("x-client-id")),
    __param(3, (0, common_1.Headers)("x-session-id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, upload_chat_dto_1.UploadChatDto, String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "uploadFile", null);
__decorate([
    (0, common_1.Post)("webhook/segmentation"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [segmentation_callback_dto_1.SegmentationCallbackDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "segmentationWebhook", null);
__decorate([
    (0, common_1.Post)("webhook/vlm"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [vlm_callback_dto_1.VlmCallbackDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "vlmWebhook", null);
__decorate([
    (0, common_1.Get)("status/:jobId"),
    __param(0, (0, common_1.Param)("jobId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Get)("sessions"),
    __param(0, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getSessions", null);
__decorate([
    (0, common_1.Get)("sessions/:sessionId"),
    __param(0, (0, common_1.Param)("sessionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getSessionById", null);
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "healthCheck", null);
exports.ChatController = ChatController = __decorate([
    (0, common_1.Controller)("chat"),
    __metadata("design:paramtypes", [chat_service_1.ChatService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map