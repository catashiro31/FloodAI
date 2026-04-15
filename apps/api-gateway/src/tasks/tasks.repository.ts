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

  private get pool() {
    return this.databaseService.getPool();
  }

  async createReasoningTask(
    task: Partial<ReasoningTaskRecord>,
  ): Promise<ReasoningTaskRecord> {
    const timestamp = this.now();
    try {
      const result = await this.pool.query(
        `INSERT INTO ${this.databaseService.getReasoningTasksTableName()}
         (job_id, session_id, status, question, image_url, mask_url, vlm_analysis,
          error_code, error_message, vlm_callback_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          task.job_id ?? null,
          task.session_id ?? null,
          task.status ?? null,
          task.question ?? null,
          task.image_url ?? null,
          task.mask_url ?? null,
          task.vlm_analysis ?? null,
          task.error_code ?? null,
          task.error_message ?? null,
          task.vlm_callback_at ?? null,
          task.created_at ?? timestamp,
          task.updated_at ?? timestamp,
        ],
      );
      return result.rows[0] as ReasoningTaskRecord;
    } catch (e) {
      this.throwDatabaseError("createReasoningTask", e);
    }
  }

  async getReasoningTask(jobId: string): Promise<ReasoningTaskRecord> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM ${this.databaseService.getReasoningTasksTableName()} WHERE job_id = $1`,
        [jobId],
      );
      if (result.rows.length === 0) {
        throw new NotFoundException(`Reasoning task ${jobId} not found`);
      }
      return result.rows[0] as ReasoningTaskRecord;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.throwDatabaseError("getReasoningTask", e);
    }
  }

  async updateReasoningTask(
    jobId: string,
    patch: Partial<ReasoningTaskRecord>,
  ): Promise<ReasoningTaskRecord> {
    const { text, values } = this.buildUpdateQuery(
      this.databaseService.getReasoningTasksTableName(),
      patch as Record<string, unknown>,
      "job_id",
      jobId,
    );
    try {
      const result = await this.pool.query(text, values);
      if (result.rows.length === 0) {
        throw new NotFoundException(`Reasoning task ${jobId} not found`);
      }
      return result.rows[0] as ReasoningTaskRecord;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.throwDatabaseError("updateReasoningTask", e);
    }
  }

  async listReasoningTasksBySession(
    sessionId: string,
  ): Promise<ReasoningTaskRecord[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM ${this.databaseService.getReasoningTasksTableName()}
         WHERE session_id = $1 ORDER BY created_at DESC`,
        [sessionId],
      );
      return result.rows as ReasoningTaskRecord[];
    } catch (e) {
      this.throwDatabaseError("listReasoningTasksBySession", e);
    }
  }

  async getLatestReasoningTaskByStatuses(
    sessionId: string,
    statuses: string[],
  ): Promise<ReasoningTaskRecord | null> {
    if (statuses.length === 0) return null;
    try {
      const result = await this.pool.query(
        `SELECT * FROM ${this.databaseService.getReasoningTasksTableName()}
         WHERE session_id = $1 AND status = ANY($2)
         ORDER BY created_at DESC LIMIT 1`,
        [sessionId, statuses],
      );
      return (result.rows[0] as ReasoningTaskRecord) ?? null;
    } catch (e) {
      this.throwDatabaseError("getLatestReasoningTaskByStatuses", e);
    }
  }

  async upsertImageTask(
    task: Partial<ImageTaskRecord>,
  ): Promise<ImageTaskRecord> {
    const timestamp = this.now();
    try {
      const result = await this.pool.query(
        `INSERT INTO ${this.databaseService.getImageTasksTableName()}
         (session_id, image_url, status, mask_url, metrics, error_code, error_message,
          segmentation_callback_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (session_id) DO UPDATE SET
           image_url = EXCLUDED.image_url,
           status = EXCLUDED.status,
           mask_url = EXCLUDED.mask_url,
           metrics = EXCLUDED.metrics,
           error_code = EXCLUDED.error_code,
           error_message = EXCLUDED.error_message,
           segmentation_callback_at = EXCLUDED.segmentation_callback_at,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          task.session_id ?? null,
          task.image_url ?? null,
          task.status ?? null,
          task.mask_url ?? null,
          task.metrics != null ? JSON.stringify(task.metrics) : null,
          task.error_code ?? null,
          task.error_message ?? null,
          task.segmentation_callback_at ?? null,
          task.created_at ?? timestamp,
          task.updated_at ?? timestamp,
        ],
      );
      return result.rows[0] as ImageTaskRecord;
    } catch (e) {
      this.throwDatabaseError("upsertImageTask", e);
    }
  }

  async getImageTaskBySession(
    sessionId: string,
  ): Promise<ImageTaskRecord | null> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM ${this.databaseService.getImageTasksTableName()} WHERE session_id = $1`,
        [sessionId],
      );
      return (result.rows[0] as ImageTaskRecord) ?? null;
    } catch (e) {
      this.throwDatabaseError("getImageTaskBySession", e);
    }
  }

  async getLatestImageTaskBySession(
    sessionId: string,
  ): Promise<ImageTaskRecord | null> {
    return this.getImageTaskBySession(sessionId);
  }

  async updateImageTask(
    sessionId: string,
    patch: Partial<ImageTaskRecord>,
  ): Promise<ImageTaskRecord> {
    const { text, values } = this.buildUpdateQuery(
      this.databaseService.getImageTasksTableName(),
      patch as Record<string, unknown>,
      "session_id",
      sessionId,
    );
    try {
      const result = await this.pool.query(text, values);
      if (result.rows.length === 0) {
        throw new NotFoundException(
          `Image task for session ${sessionId} not found`,
        );
      }
      return result.rows[0] as ImageTaskRecord;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      this.throwDatabaseError("updateImageTask", e);
    }
  }

  async upsertSession(session: Partial<SessionRecord>): Promise<SessionRecord> {
    const existing = await this.getSession(session.session_id!);
    const timestamp = this.now();
    const context = session.context ?? existing?.context ?? {};
    const lastQuestion =
      session.last_question === undefined
        ? (existing?.last_question ?? null)
        : session.last_question;
    const lastReply =
      session.last_reply === undefined
        ? (existing?.last_reply ?? null)
        : session.last_reply;
    const createdAt = existing?.created_at ?? session.created_at ?? timestamp;

    try {
      const result = await this.pool.query(
        `INSERT INTO ${this.databaseService.getSessionsTableName()}
         (session_id, context, last_question, last_reply, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (session_id) DO UPDATE SET
           context = EXCLUDED.context,
           last_question = EXCLUDED.last_question,
           last_reply = EXCLUDED.last_reply,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          session.session_id,
          JSON.stringify(context),
          lastQuestion,
          lastReply,
          createdAt,
          timestamp,
        ],
      );
      return result.rows[0] as SessionRecord;
    } catch (e) {
      this.throwDatabaseError("upsertSession", e);
    }
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM ${this.databaseService.getSessionsTableName()} WHERE session_id = $1`,
        [sessionId],
      );
      return (result.rows[0] as SessionRecord) ?? null;
    } catch (e) {
      this.throwDatabaseError("getSession", e);
    }
  }

  async listSessions(limit = 50): Promise<SessionRecord[]> {
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    try {
      const result = await this.pool.query(
        `SELECT * FROM ${this.databaseService.getSessionsTableName()}
         ORDER BY updated_at DESC LIMIT $1`,
        [cappedLimit],
      );
      return result.rows as SessionRecord[];
    } catch (e) {
      this.throwDatabaseError("listSessions", e);
    }
  }

  async createHistoryEntry(
    entry: Omit<SessionHistoryRecord, "history_id">,
  ): Promise<SessionHistoryRecord> {
    try {
      const result = await this.pool.query(
        `INSERT INTO ${this.databaseService.getSessionHistoryTableName()}
         (session_id, reasoning_task_id, role, content, image_urls, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          entry.session_id,
          entry.reasoning_task_id ?? null,
          entry.role,
          entry.content,
          JSON.stringify(entry.image_urls ?? []),
          entry.created_at ?? this.now(),
        ],
      );
      return result.rows[0] as SessionHistoryRecord;
    } catch (e) {
      this.throwDatabaseError("createHistoryEntry", e);
    }
  }

  async listHistoryBySession(
    sessionId: string,
  ): Promise<SessionHistoryRecord[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM ${this.databaseService.getSessionHistoryTableName()}
         WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId],
      );
      return result.rows as SessionHistoryRecord[];
    } catch (e) {
      this.throwDatabaseError("listHistoryBySession", e);
    }
  }

  async deleteHistoryBySession(sessionId: string) {
    try {
      await this.pool.query(
        `DELETE FROM ${this.databaseService.getSessionHistoryTableName()} WHERE session_id = $1`,
        [sessionId],
      );
    } catch (e) {
      this.throwDatabaseError("deleteHistoryBySession", e);
    }
  }

  async countHistoryBySessionIds(sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return new Map<string, number>();
    }
    try {
      const result = await this.pool.query(
        `SELECT session_id, COUNT(*)::int AS cnt
         FROM ${this.databaseService.getSessionHistoryTableName()}
         WHERE session_id = ANY($1)
         GROUP BY session_id`,
        [sessionIds],
      );
      const counts = new Map<string, number>();
      for (const row of result.rows) {
        counts.set(
          (row as { session_id: string; cnt: number }).session_id,
          (row as { session_id: string; cnt: number }).cnt,
        );
      }
      return counts;
    } catch (e) {
      this.throwDatabaseError("countHistoryBySessionIds", e);
    }
  }

  private buildUpdateQuery(
    table: string,
    patch: Record<string, unknown>,
    whereCol: string,
    whereVal: string,
  ): { text: string; values: unknown[] } {
    const entries = Object.entries({ ...patch, updated_at: this.now() }).filter(
      ([k]) => k !== whereCol && k !== "created_at",
    );
    const setClauses = entries
      .map(([k], i) => `${k} = $${i + 1}`)
      .join(", ");
    const values: unknown[] = entries.map(([k, v]) =>
      (k === "metrics" || k === "context") && v !== null && typeof v === "object"
        ? JSON.stringify(v)
        : v,
    );
    values.push(whereVal);
    return {
      text: `UPDATE ${table} SET ${setClauses} WHERE ${whereCol} = $${values.length} RETURNING *`,
      values,
    };
  }

  private now() {
    return new Date().toISOString();
  }

  private throwDatabaseError(operation: string, error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    throw new InternalServerErrorException(
      `Database ${operation} failed: ${message}`,
    );
  }
}
