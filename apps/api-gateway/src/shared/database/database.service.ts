import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

@Injectable()
export class SharedDatabaseService {
  private readonly pool: Pool;
  private readonly sessionsTableName: string;
  private readonly imageTasksTableName: string;
  private readonly reasoningTasksTableName: string;
  private readonly sessionHistoryTableName: string;

  constructor(private readonly configService: ConfigService) {
    const connectionString = this.configService.get<string>("DATABASE_URL");

    if (!connectionString) {
      throw new Error("DATABASE_URL must be configured");
    }

    this.pool = new Pool({ connectionString });

    this.sessionsTableName =
      this.configService.get<string>("SUPABASE_SESSIONS_TABLE") || "sessions";
    this.imageTasksTableName =
      this.configService.get<string>("SUPABASE_TASK_IMAGE_TABLE") ||
      "task_image";
    this.reasoningTasksTableName =
      this.configService.get<string>("SUPABASE_TASK_REASONING_TABLE") ||
      "task_reasoning";
    this.sessionHistoryTableName =
      this.configService.get<string>("SUPABASE_SESSION_HISTORY_TABLE") ||
      "session_history";
  }

  getPool() {
    return this.pool;
  }

  getSessionsTableName() {
    return this.sessionsTableName;
  }

  getImageTasksTableName() {
    return this.imageTasksTableName;
  }

  getReasoningTasksTableName() {
    return this.reasoningTasksTableName;
  }

  getSessionHistoryTableName() {
    return this.sessionHistoryTableName;
  }
}
