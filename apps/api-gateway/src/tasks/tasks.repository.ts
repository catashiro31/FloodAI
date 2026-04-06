import { Injectable, NotFoundException } from "@nestjs/common";
import { SharedSupabaseService } from "../shared/supabase/supabase.service";
import { SessionRecord, TaskRecord } from "./task.types";

@Injectable()
export class TasksRepository {
  constructor(private readonly supabaseService: SharedSupabaseService) {}

  async createTask(task: TaskRecord) {
    const { error } = await this.supabaseService
      .getClient()
      .from(this.supabaseService.getTasksTableName())
      .insert(task);

    if (error) {
      throw error;
    }

    return task;
  }

  async getTask(jobId: string): Promise<TaskRecord> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.supabaseService.getTasksTableName())
      .select("*")
      .eq("job_id", jobId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Task ${jobId} not found`);
    }

    return data as TaskRecord;
  }

  async updateTask(jobId: string, patch: Partial<TaskRecord>) {
    const payload = {
      ...patch,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.supabaseService.getTasksTableName())
      .update(payload)
      .eq("job_id", jobId)
      .select("*")
      .single();

    if (error || !data) {
      throw error ?? new NotFoundException(`Task ${jobId} not found`);
    }

    return data as TaskRecord;
  }

  async upsertSession(session: SessionRecord) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.supabaseService.getSessionsTableName())
      .upsert(session, {
        onConflict: "session_id",
      })
      .select("*")
      .single();

    if (error || !data) {
      throw (
        error ??
        new NotFoundException(`Session ${session.session_id} not found`)
      );
    }

    return data as SessionRecord;
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.supabaseService.getSessionsTableName())
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as SessionRecord | null) ?? null;
  }

  async listSessions(limit = 50): Promise<SessionRecord[]> {
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.supabaseService.getSessionsTableName())
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(cappedLimit);

    if (error) {
      throw error;
    }

    return (data as SessionRecord[]) ?? [];
  }
}
