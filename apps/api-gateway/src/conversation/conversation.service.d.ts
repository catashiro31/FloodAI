import { TasksRepository } from "../tasks/tasks.repository";
import { SessionHistoryItem } from "../tasks/task.types";
export declare class ConversationService {
    private readonly repository;
    constructor(repository: TasksRepository);
    getSession(sessionId: string): Promise<import("../tasks/entities/session.entity").Session>;
    listSessions(limit?: number): Promise<import("../tasks/entities/session.entity").Session[]>;
    ensureSession(sessionId: string, jobId: string, initialQuestion?: string): Promise<import("../tasks/entities/session.entity").Session>;
    recordUserMessage(sessionId: string, jobId: string, message: string, reset?: boolean): Promise<Partial<import("../tasks/entities/session.entity").Session> & import("../tasks/entities/session.entity").Session>;
    recordAssistantResponse(sessionId: string, jobId: string, reply: string, context?: Record<string, unknown>, history?: SessionHistoryItem[]): Promise<Partial<import("../tasks/entities/session.entity").Session> & import("../tasks/entities/session.entity").Session>;
    private createHistoryItem;
}
