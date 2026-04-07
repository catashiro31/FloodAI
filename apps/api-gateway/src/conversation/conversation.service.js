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
exports.ConversationService = void 0;
const common_1 = require("@nestjs/common");
const tasks_repository_1 = require("../tasks/tasks.repository");
let ConversationService = class ConversationService {
    constructor(repository) {
        this.repository = repository;
    }
    async getSession(sessionId) {
        return this.repository.getSession(sessionId);
    }
    async listSessions(limit = 50) {
        return this.repository.listSessions(limit);
    }
    async ensureSession(sessionId, jobId, initialQuestion) {
        const existing = await this.repository.getSession(sessionId);
        if (existing) {
            return existing;
        }
        const history = initialQuestion
            ? [this.createHistoryItem("user", initialQuestion)]
            : [];
        return this.repository.upsertSession({
            session_id: sessionId,
            context: {
                initialQuestion: (initialQuestion === null || initialQuestion === void 0 ? void 0 : initialQuestion.trim()) || null,
            },
            history,
            last_question: (initialQuestion === null || initialQuestion === void 0 ? void 0 : initialQuestion.trim()) || null,
            last_reply: null,
        });
    }
    async recordUserMessage(sessionId, jobId, message, reset = false) {
        const session = await this.repository.getSession(sessionId);
        const history = reset ? [] : (session === null || session === void 0 ? void 0 : session.history) || [];
        const nextHistory = [...history, this.createHistoryItem("user", message)];
        return this.repository.upsertSession({
            session_id: sessionId,
            context: Object.assign(Object.assign({}, ((session === null || session === void 0 ? void 0 : session.context) || {})), { reset }),
            history: nextHistory,
            last_question: message,
            last_reply: reset ? null : (session === null || session === void 0 ? void 0 : session.last_reply) || null,
        });
    }
    async recordAssistantResponse(sessionId, jobId, reply, context, history) {
        const session = await this.repository.getSession(sessionId);
        const nextHistory = history && history.length
            ? history
            : [
                ...((session === null || session === void 0 ? void 0 : session.history) || []),
                this.createHistoryItem("assistant", reply),
            ];
        const nextContext = Object.assign(Object.assign(Object.assign({}, ((session === null || session === void 0 ? void 0 : session.context) || {})), (context || {})), { updatedAt: new Date().toISOString() });
        return this.repository.upsertSession({
            session_id: sessionId,
            context: nextContext,
            history: nextHistory,
            last_question: (session === null || session === void 0 ? void 0 : session.last_question) || null,
            last_reply: reply,
        });
    }
    createHistoryItem(role, content) {
        return {
            role,
            content,
            createdAt: new Date().toISOString(),
        };
    }
};
exports.ConversationService = ConversationService;
exports.ConversationService = ConversationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tasks_repository_1.TasksRepository])
], ConversationService);
//# sourceMappingURL=conversation.service.js.map