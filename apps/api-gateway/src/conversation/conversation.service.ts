import { Injectable } from "@nestjs/common";
import { SessionHistoryRecord, SessionRecord } from "../tasks/task.types";
import { TasksRepository } from "../tasks/tasks.repository";

@Injectable()
export class ConversationService {
  constructor(private readonly repository: TasksRepository) {}

  async getSession(sessionId: string) {
    const [session, imageTask, reasoningTasks, history] = await Promise.all([
      this.repository.getSession(sessionId),
      this.repository.getLatestImageTaskBySession(sessionId),
      this.repository.listReasoningTasksBySession(sessionId),
      this.repository.listHistoryBySession(sessionId),
    ]);

    if (!session) {
      return null;
    }

    return {
      ...session,
      image_task: imageTask,
      reasoning_tasks: reasoningTasks,
      history,
      history_count: history.length,
    } satisfies SessionRecord;
  }

  async listSessions(limit = 50) {
    const sessions = await this.repository.listSessions(limit);
    const historyCounts = await this.repository.countHistoryBySessionIds(
      sessions.map((session) => session.session_id),
    );

    return sessions.map((session) => ({
      ...session,
      history_count: historyCounts.get(session.session_id) ?? 0,
    }));
  }

  async ensureSession(
    sessionId: string,
    initialQuestion?: string,
    imageUrls?: string[],
  ) {
    const existing = await this.repository.getSession(sessionId);

    if (existing) {
      return existing;
    }

    return this.repository.upsertSession({
      session_id: sessionId,
      context: {
        initialQuestion: initialQuestion?.trim() || null,
        initialImageUrls: imageUrls || [],
      },
      last_question: initialQuestion?.trim() || null,
      last_reply: null,
    });
  }

  async recordUserMessage(
    sessionId: string,
    jobId: string,
    message: string,
    reset = false,
    imageUrls?: string[],
  ) {
    const session = await this.repository.getSession(sessionId);

    if (reset) {
      await this.repository.deleteHistoryBySession(sessionId);
    }

    await this.repository.createHistoryEntry(
      this.createHistoryItem(sessionId, jobId, "user", message, imageUrls),
    );

    return this.repository.upsertSession({
      session_id: sessionId,
      context: {
        ...(session?.context || {}),
        reset,
      },
      last_question: message,
      last_reply: reset ? null : session?.last_reply || null,
    });
  }

  async recordAssistantResponse(
    sessionId: string,
    jobId: string,
    reply: string,
    context?: Record<string, unknown>,
    imageUrls?: string[],
  ) {
    const session = await this.repository.getSession(sessionId);

    await this.repository.createHistoryEntry(
      this.createHistoryItem(sessionId, jobId, "assistant", reply, imageUrls),
    );

    const nextContext = {
      ...(session?.context || {}),
      ...(context || {}),
      updatedAt: new Date().toISOString(),
    };

    return this.repository.upsertSession({
      session_id: sessionId,
      context: nextContext,
      last_question: session?.last_question || null,
      last_reply: reply,
    });
  }

  private createHistoryItem(
    sessionId: string,
    reasoningTaskId: string,
    role: SessionHistoryRecord["role"],
    content: string,
    imageUrls?: string[],
  ): Omit<SessionHistoryRecord, "history_id"> {
    return {
      session_id: sessionId,
      reasoning_task_id: reasoningTaskId,
      role,
      content,
      created_at: new Date().toISOString(),
      image_urls: imageUrls || [],
    };
  }
}
