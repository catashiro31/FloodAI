import { Server } from "socket.io";
export declare class RealtimeService {
    private server?;
    private readonly taskClientMap;
    private readonly taskSessionMap;
    bindServer(server: Server): void;
    registerSessionClient(sessionId: string, clientId?: string): void;
    registerTaskClient(taskId: string, clientId?: string): void;
    registerTaskSession(taskId: string, sessionId: string): void;
    getClientIdForTask(taskId: string): string;
    getSessionIdForTask(taskId: string): string;
    clearClient(clientId: string): void;
    sendStatus(clientId: string | undefined, status: string, details?: unknown, sessionId?: string): void;
    sendReply(clientId: string | undefined, payload: Record<string, unknown>, sessionId?: string): void;
}
