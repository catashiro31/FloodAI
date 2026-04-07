"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeService = void 0;
const common_1 = require("@nestjs/common");
let RealtimeService = class RealtimeService {
    constructor() {
        this.taskClientMap = new Map();
        this.taskSessionMap = new Map();
    }
    bindServer(server) {
        this.server = server;
    }
    registerSessionClient(sessionId, clientId) {
        if (!clientId || !this.server) {
            return;
        }
        const socket = this.server.sockets.sockets.get(clientId);
        if (socket) {
            socket.join(sessionId);
        }
    }
    registerTaskClient(taskId, clientId) {
        if (clientId) {
            this.taskClientMap.set(taskId, clientId);
        }
    }
    registerTaskSession(taskId, sessionId) {
        this.taskSessionMap.set(taskId, sessionId);
    }
    getClientIdForTask(taskId) {
        return this.taskClientMap.get(taskId);
    }
    getSessionIdForTask(taskId) {
        return this.taskSessionMap.get(taskId);
    }
    clearClient(clientId) {
        for (const [taskId, mappedClientId] of this.taskClientMap.entries()) {
            if (mappedClientId === clientId) {
                this.taskClientMap.delete(taskId);
            }
        }
    }
    sendStatus(clientId, status, details, sessionId) {
        if (!this.server) {
            return;
        }
        const payload = {
            status,
            details,
            timestamp: Date.now(),
        };
        if (sessionId) {
            this.server.to(sessionId).emit("uploadStatus", payload);
        }
        if (clientId) {
            this.server.to(clientId).emit("uploadStatus", payload);
        }
    }
    sendReply(clientId, payload, sessionId) {
        if (!this.server) {
            return;
        }
        const replyPayload = Object.assign(Object.assign({}, payload), { createdAt: Date.now() });
        if (sessionId) {
            this.server.to(sessionId).emit("receiveMessage", replyPayload);
        }
        if (clientId) {
            this.server.to(clientId).emit("receiveMessage", replyPayload);
        }
    }
};
exports.RealtimeService = RealtimeService;
exports.RealtimeService = RealtimeService = __decorate([
    (0, common_1.Injectable)()
], RealtimeService);
//# sourceMappingURL=realtime.service.js.map