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
var TasksService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksService = void 0;
const common_1 = require("@nestjs/common");
const crypto = require("crypto");
const task_status_1 = require("../common/task-status");
const cloudinary_service_1 = require("../shared/storage/cloudinary.service");
const tasks_repository_1 = require("./tasks.repository");
let TasksService = TasksService_1 = class TasksService {
    constructor(repository, cloudinaryService) {
        this.repository = repository;
        this.cloudinaryService = cloudinaryService;
        this.logger = new common_1.Logger(TasksService_1.name);
    }
    async createTaskFromUpload(input) {
        var _a;
        const jobId = crypto.randomUUID();
        const fileHash = crypto
            .createHash("sha256")
            .update(input.file.buffer)
            .digest("hex");
        const fileExtension = this.resolveFileExtension(input.file.mimetype);
        const fileName = `${fileHash}.${fileExtension}`;
        const existingFiles = await this.cloudinaryService.findFile(fileName);
        let imageUrl;
        if (existingFiles.length > 0) {
            imageUrl = existingFiles[0].secure_url;
        }
        else {
            const uploadResult = await this.cloudinaryService.uploadFile(input.file.buffer, fileName);
            imageUrl = uploadResult.secure_url;
        }
        const task = {
            job_id: jobId,
            session_id: input.sessionId,
            image_url: imageUrl,
            status: task_status_1.TaskStatus.Queued,
            question: ((_a = input.question) === null || _a === void 0 ? void 0 : _a.trim()) || null,
        };
        const savedTask = await this.repository.createTask(task);
        this.logger.log(`Created task ${jobId} for session ${input.sessionId}`);
        return savedTask;
    }
    async getTask(jobId) {
        return this.repository.getTask(jobId);
    }
    async setSegmentationProcessing(jobId) {
        return this.transition(jobId, task_status_1.TaskStatus.ProcessingSegmentation);
    }
    async setSegmentationSuccess(jobId, maskAllOverlay) {
        return this.transition(jobId, task_status_1.TaskStatus.SuccessSegmentation, {
            mask_all_overlay: maskAllOverlay || null,
            segmentation_callback_at: new Date(),
        });
    }
    async setVlmProcessing(jobId, question) {
        return this.transition(jobId, task_status_1.TaskStatus.ProcessingVlm, {
            question: (question === null || question === void 0 ? void 0 : question.trim()) || null,
        });
    }
    async setVlmSuccess(jobId, reply, sessionId) {
        return this.transition(jobId, task_status_1.TaskStatus.SuccessVlm, {
            vlm_analysis: reply,
            session_id: sessionId,
            vlm_callback_at: new Date(),
        });
    }
    async setError(jobId, errorCode, errorMessage) {
        const task = await this.repository.getTask(jobId);
        if (task.status === task_status_1.TaskStatus.Error) {
            return this.repository.updateTask(jobId, {
                error_code: errorCode,
                error_message: errorMessage,
            });
        }
        return this.transition(jobId, task_status_1.TaskStatus.Error, {
            error_code: errorCode,
            error_message: errorMessage,
        });
    }
    async transition(jobId, nextStatus, patch = {}) {
        const task = await this.getTask(jobId);
        if (task.status === nextStatus) {
            return task;
        }
        if (!(0, task_status_1.canTransitionStatus)(task.status, nextStatus)) {
            throw new common_1.ConflictException(`Invalid task transition ${task.status} -> ${nextStatus} for ${jobId}`);
        }
        return this.repository.updateTask(jobId, Object.assign(Object.assign({}, patch), { status: nextStatus }));
    }
    resolveFileExtension(mimeType) {
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
};
exports.TasksService = TasksService;
exports.TasksService = TasksService = TasksService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tasks_repository_1.TasksRepository,
        cloudinary_service_1.CloudinaryService])
], TasksService);
//# sourceMappingURL=tasks.service.js.map