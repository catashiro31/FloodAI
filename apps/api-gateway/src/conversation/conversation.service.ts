import { Injectable } from "@nestjs/common";
import { TasksRepository } from "../tasks/tasks.repository";
import { SessionHistoryItem } from "../tasks/task.types";

@Injectable()
export class ConversationService {
  constructor(private readonly repository: TasksRepository) {}

  async getSession(sessionId: string) {
    return this.repository.getSession(sessionId);
  }

  async listSessions(limit = 50) {
    return this.repository.listSessions(limit);
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

    const history = initialQuestion
      ? [this.createHistoryItem("user", initialQuestion, imageUrls)]
      : [];

    return this.repository.upsertSession({
      session_id: sessionId,
      context: {
        initialQuestion: initialQuestion?.trim() || null,
      },
      history,
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
    const history = reset ? [] : session?.history || [];
    const nextHistory = [
      ...history,
      this.createHistoryItem("user", message, imageUrls),
    ];

    return this.repository.upsertSession({
      session_id: sessionId,
      context: {
        ...(session?.context || {}),
        reset,
      },
      history: nextHistory,
      last_question: message,
      last_reply: reset ? null : session?.last_reply || null,
    });
  }

  async recordAssistantResponse(
    sessionId: string,
    jobId: string,
    reply: string,
    context?: Record<string, unknown>,
    history?: SessionHistoryItem[],
    imageUrls?: string[],
  ) {
    const session = await this.repository.getSession(sessionId);
    const nextHistory =
      history && history.length
        ? history
        : [
            ...(session?.history || []),
            this.createHistoryItem("assistant", reply, imageUrls),
          ];

    const nextContext = {
      ...(session?.context || {}),
      ...(context || {}),
      updatedAt: new Date().toISOString(),
    };

    return this.repository.upsertSession({
      session_id: sessionId,
      context: nextContext,
      history: nextHistory,
      last_question: session?.last_question || null,
      last_reply: reply,
    });
  }

  private createHistoryItem(
    role: SessionHistoryItem["role"],
    content: string,
    imageUrls?: string[],
  ): SessionHistoryItem {
    return {
      role,
      content,
      createdAt: new Date().toISOString(),
      imageUrls: imageUrls || [],
    };
  }
}
