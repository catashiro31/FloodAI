import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { SharedDatabaseService } from "../shared/database/database.service";
import {
  ImageTaskRecord,
  ReasoningTaskRecord,
  SessionHistoryRecord,
  SessionRecord,
} from "./task.types";

@Injectable()
export class TasksRepository {
  constructor(private readonly databaseService: SharedDatabaseService) {}

  private get client() {
    return this.databaseService.getClient();
  }

  async createReasoningTask(
    task: Partial<ReasoningTaskRecord>,
  ): Promise<ReasoningTaskRecord> {
    const timestamp = this.now();
    const payload = {
      job_id: task.job_id,
      session_id: task.session_id,
      status: task.status,
      question: task.question ?? null,
      vlm_analysis: task.vlm_analysis ?? null,
      error_code: task.error_code ?? null,
      error_message: task.error_message ?? null,
      vlm_callback_at: task.vlm_callback_at ?? null,
      created_at: task.created_at ?? timestamp,
      updated_at: task.updated_at ?? timestamp,
    };

    const { data, error } = await this.client
      .from(this.databaseService.getReasoningTasksTableName())
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.throwDatabaseError("createReasoningTask", error);
    }

    return data as ReasoningTaskRecord;
  }

  async getReasoningTask(jobId: string): Promise<ReasoningTaskRecord> {
    const { data, error } = await this.client
      .from(this.databaseService.getReasoningTasksTableName())
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();

    if (error) {
      this.throwDatabaseError("getReasoningTask", error);
    }

    if (!data) {
      throw new NotFoundException(`Reasoning task ${jobId} not found`);
    }

    return data as ReasoningTaskRecord;
  }

  async updateReasoningTask(
    jobId: string,
    patch: Partial<ReasoningTaskRecord>,
  ): Promise<ReasoningTaskRecord> {
    const { data, error } = await this.client
      .from(this.databaseService.getReasoningTasksTableName())
      .update({
        ...patch,
        updated_at: this.now(),
      })
      .eq("job_id", jobId)
      .select("*")
      .maybeSingle();

    if (error) {
      this.throwDatabaseError("updateReasoningTask", error);
    }

    if (!data) {
      throw new NotFoundException(`Reasoning task ${jobId} not found`);
    }

    return data as ReasoningTaskRecord;
  }

  async listReasoningTasksBySession(
    sessionId: string,
  ): Promise<ReasoningTaskRecord[]> {
    const { data, error } = await this.client
      .from(this.databaseService.getReasoningTasksTableName())
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (error) {
      this.throwDatabaseError("listReasoningTasksBySession", error);
    }

    return (data ?? []) as ReasoningTaskRecord[];
  }

  async getLatestQueuedReasoningTask(
    sessionId: string,
  ): Promise<ReasoningTaskRecord | null> {
    const { data, error } = await this.client
      .from(this.databaseService.getReasoningTasksTableName())
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "queued")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.throwDatabaseError("getLatestQueuedReasoningTask", error);
    }

    return (data as ReasoningTaskRecord | null) ?? null;
  }

  async createImageTask(
    task: Partial<ImageTaskRecord>,
  ): Promise<ImageTaskRecord> {
    const timestamp = this.now();
    const payload = {
      job_id: task.job_id,
      session_id: task.session_id,
      image_url: task.image_url,
      status: task.status,
      mask_all_overlay: task.mask_all_overlay ?? null,
      metrics: task.metrics ?? null,
      error_code: task.error_code ?? null,
      error_message: task.error_message ?? null,
      segmentation_callback_at: task.segmentation_callback_at ?? null,
      created_at: task.created_at ?? timestamp,
      updated_at: task.updated_at ?? timestamp,
    };

    const { data, error } = await this.client
      .from(this.databaseService.getImageTasksTableName())
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.throwDatabaseError("createImageTask", error);
    }

    return data as ImageTaskRecord;
  }

  async getImageTask(jobId: string): Promise<ImageTaskRecord | null> {
    const { data, error } = await this.client
      .from(this.databaseService.getImageTasksTableName())
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();

    if (error) {
      this.throwDatabaseError("getImageTask", error);
    }

    return (data as ImageTaskRecord | null) ?? null;
  }

  async getLatestImageTaskBySession(
    sessionId: string,
  ): Promise<ImageTaskRecord | null> {
    const { data, error } = await this.client
      .from(this.databaseService.getImageTasksTableName())
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.throwDatabaseError("getLatestImageTaskBySession", error);
    }

    return (data as ImageTaskRecord | null) ?? null;
  }

  async listImageTasksBySession(sessionId: string): Promise<ImageTaskRecord[]> {
    const { data, error } = await this.client
      .from(this.databaseService.getImageTasksTableName())
      .select("*")
      .eq("session_id", sessionId);

    if (error) {
      this.throwDatabaseError("listImageTasksBySession", error);
    }

    return (data ?? []) as ImageTaskRecord[];
  }

  async updateImageTask(
    jobId: string,
    patch: Partial<ImageTaskRecord>,
  ): Promise<ImageTaskRecord> {
    const { data, error } = await this.client
      .from(this.databaseService.getImageTasksTableName())
      .update({
        ...patch,
        updated_at: this.now(),
      })
      .eq("job_id", jobId)
      .select("*")
      .maybeSingle();

    if (error) {
      this.throwDatabaseError("updateImageTask", error);
    }

    if (!data) {
      throw new NotFoundException(`Image task for job ${jobId} not found`);
    }

    return data as ImageTaskRecord;
  }

  async upsertSession(session: Partial<SessionRecord>): Promise<SessionRecord> {
    const existing = await this.getSession(session.session_id!);
    const timestamp = this.now();
    const payload = {
      session_id: session.session_id,
      context: session.context ?? existing?.context ?? {},
      last_question:
        session.last_question === undefined
          ? (existing?.last_question ?? null)
          : session.last_question,
      last_reply:
        session.last_reply === undefined
          ? (existing?.last_reply ?? null)
          : session.last_reply,
      created_at: existing?.created_at ?? session.created_at ?? timestamp,
      updated_at: timestamp,
    };
    const { data, error } = await this.client
      .from(this.databaseService.getSessionsTableName())
      .upsert(payload, { onConflict: "session_id" })
      .select("*")
      .single();

    if (error) {
      this.throwDatabaseError("upsertSession", error);
    }

    return data as SessionRecord;
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client
      .from(this.databaseService.getSessionsTableName())
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      this.throwDatabaseError("getSession", error);
    }

    return (data as SessionRecord | null) ?? null;
  }

  async listSessions(limit = 50): Promise<SessionRecord[]> {
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const { data, error } = await this.client
      .from(this.databaseService.getSessionsTableName())
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(cappedLimit);

    if (error) {
      this.throwDatabaseError("listSessions", error);
    }

    return (data ?? []) as SessionRecord[];
  }

  async createHistoryEntry(
    entry: Omit<SessionHistoryRecord, "history_id">,
  ): Promise<SessionHistoryRecord> {
    const payload = {
      session_id: entry.session_id,
      reasoning_task_id: entry.reasoning_task_id ?? null,
      role: entry.role,
      content: entry.content,
      image_urls: entry.image_urls ?? [],
      created_at: entry.created_at ?? this.now(),
    };

    const { data, error } = await this.client
      .from(this.databaseService.getSessionHistoryTableName())
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.throwDatabaseError("createHistoryEntry", error);
    }

    return data as SessionHistoryRecord;
  }

  async listHistoryBySession(
    sessionId: string,
  ): Promise<SessionHistoryRecord[]> {
    const { data, error } = await this.client
      .from(this.databaseService.getSessionHistoryTableName())
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      this.throwDatabaseError("listHistoryBySession", error);
    }

    return (data ?? []) as SessionHistoryRecord[];
  }

  async deleteHistoryBySession(sessionId: string) {
    const { error } = await this.client
      .from(this.databaseService.getSessionHistoryTableName())
      .delete()
      .eq("session_id", sessionId);

    if (error) {
      this.throwDatabaseError("deleteHistoryBySession", error);
    }
  }

  async countHistoryBySessionIds(sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return new Map<string, number>();
    }

    const { data, error } = await this.client
      .from(this.databaseService.getSessionHistoryTableName())
      .select("session_id")
      .in("session_id", sessionIds);

    if (error) {
      this.throwDatabaseError("countHistoryBySessionIds", error);
    }

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const sessionId = (row as { session_id: string }).session_id;
      counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
    }

    return counts;
  }

  private now() {
    return new Date().toISOString();
  }

  private throwDatabaseError(operation: string, error: { message: string }) {
    throw new InternalServerErrorException(
      `Supabase ${operation} failed: ${error.message}`,
    );
  }
}
