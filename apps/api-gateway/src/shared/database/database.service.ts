import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class SharedDatabaseService {
  private readonly client: SupabaseClient;
  private readonly sessionsTableName: string;
  private readonly imageTasksTableName: string;
  private readonly reasoningTasksTableName: string;
  private readonly sessionHistoryTableName: string;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>("SUPABASE_URL");
    const supabaseKey =
      this.configService.get<string>("SUPABASE_SERVICE_ROLE_KEY") ||
      this.configService.get<string>("SUPABASE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY must be configured",
      );
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

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

  getClient() {
    return this.client;
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
