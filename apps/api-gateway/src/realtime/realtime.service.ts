import { Injectable } from "@nestjs/common";
import { Server } from "socket.io";

@Injectable()
export class RealtimeService {
  private server?: Server;
  private readonly taskClientMap = new Map<string, string>();
  private readonly taskSessionMap = new Map<string, string>();

  bindServer(server: Server) {
    this.server = server;
  }

  registerSessionClient(sessionId: string, clientId?: string) {
    if (!clientId || !this.server) {
      return;
    }

    const socket = this.server.sockets.sockets.get(clientId);
    if (socket) {
      socket.join(sessionId);
    }
  }

  registerTaskClient(taskId: string, clientId?: string) {
    if (clientId) {
      this.taskClientMap.set(taskId, clientId);
    }
  }

  registerTaskSession(taskId: string, sessionId: string) {
    this.taskSessionMap.set(taskId, sessionId);
  }

  getClientIdForTask(taskId: string) {
    return this.taskClientMap.get(taskId);
  }

  getSessionIdForTask(taskId: string) {
    return this.taskSessionMap.get(taskId);
  }

  clearClient(clientId: string) {
    for (const [taskId, mappedClientId] of this.taskClientMap.entries()) {
      if (mappedClientId === clientId) {
        this.taskClientMap.delete(taskId);
      }
    }
  }

  sendStatus(
    clientId: string | undefined,
    status: string,
    details?: unknown,
    sessionId?: string,
  ) {
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

    if (clientId && this.shouldEmitDirectly(clientId, sessionId)) {
      this.server.to(clientId).emit("uploadStatus", payload);
    }
  }

  sendReply(
    clientId: string | undefined,
    payload: Record<string, unknown>,
    sessionId?: string,
  ) {
    if (!this.server) {
      return;
    }

    const replyPayload = {
      ...payload,
      createdAt: Date.now(),
    };

    if (sessionId) {
      this.server.to(sessionId).emit("receiveMessage", replyPayload);
    }

    if (clientId && this.shouldEmitDirectly(clientId, sessionId)) {
      this.server.to(clientId).emit("receiveMessage", replyPayload);
    }
  }

  private shouldEmitDirectly(clientId: string, sessionId?: string) {
    if (!sessionId || !this.server) {
      return true;
    }

    const socket = this.server.sockets.sockets.get(clientId);
    return !socket?.rooms?.has(sessionId);
  }
}
