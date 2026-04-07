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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Task = exports.TaskStatus = void 0;
const typeorm_1 = require("typeorm");
const session_entity_1 = require("./session.entity");
var task_status_1 = require("../../common/task-status");
Object.defineProperty(exports, "TaskStatus", { enumerable: true, get: function () { return task_status_1.TaskStatus; } });
const task_status_2 = require("../../common/task-status");
let Task = class Task {
};
exports.Task = Task;
__decorate([
    (0, typeorm_1.PrimaryColumn)("uuid"),
    __metadata("design:type", String)
], Task.prototype, "job_id", void 0);
__decorate([
    (0, typeorm_1.Column)("uuid"),
    __metadata("design:type", String)
], Task.prototype, "session_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => session_entity_1.Session, (session) => session.tasks),
    (0, typeorm_1.JoinColumn)({ name: "session_id" }),
    __metadata("design:type", session_entity_1.Session)
], Task.prototype, "session", void 0);
__decorate([
    (0, typeorm_1.Column)("text"),
    __metadata("design:type", String)
], Task.prototype, "image_url", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: "enum",
        enum: task_status_2.TaskStatus,
        default: task_status_2.TaskStatus.Queued,
    }),
    __metadata("design:type", String)
], Task.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)("text", { nullable: true }),
    __metadata("design:type", String)
], Task.prototype, "question", void 0);
__decorate([
    (0, typeorm_1.Column)("text", { nullable: true }),
    __metadata("design:type", String)
], Task.prototype, "mask_all_overlay", void 0);
__decorate([
    (0, typeorm_1.Column)("text", { nullable: true }),
    __metadata("design:type", String)
], Task.prototype, "vlm_analysis", void 0);
__decorate([
    (0, typeorm_1.Column)("text", { nullable: true }),
    __metadata("design:type", String)
], Task.prototype, "error_code", void 0);
__decorate([
    (0, typeorm_1.Column)("text", { nullable: true }),
    __metadata("design:type", String)
], Task.prototype, "error_message", void 0);
__decorate([
    (0, typeorm_1.Column)("timestamptz", { nullable: true }),
    __metadata("design:type", Date)
], Task.prototype, "segmentation_callback_at", void 0);
__decorate([
    (0, typeorm_1.Column)("timestamptz", { nullable: true }),
    __metadata("design:type", Date)
], Task.prototype, "vlm_callback_at", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ type: "timestamptz" }),
    __metadata("design:type", Date)
], Task.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ type: "timestamptz" }),
    __metadata("design:type", Date)
], Task.prototype, "updated_at", void 0);
exports.Task = Task = __decorate([
    (0, typeorm_1.Entity)("tasks")
], Task);
//# sourceMappingURL=task.entity.js.map