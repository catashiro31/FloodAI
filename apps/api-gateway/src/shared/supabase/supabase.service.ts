import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class SharedSupabaseService {
  private readonly client: SupabaseClient;
  private readonly bucketName: string;
  private readonly tasksTableName: string;
  private readonly sessionsTableName: string;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>("SUPABASE_URL");
    const supabaseKey = this.configService.get<string>("SUPABASE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be configured");
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.bucketName =
      this.configService.get<string>("SUPABASE_IMAGES_BUCKET") ||
      this.configService.get<string>("SUPABASE_BUCKET") ||
      "images";
    this.tasksTableName =
      this.configService.get<string>("SUPABASE_TASKS_TABLE") || "tasks";
    this.sessionsTableName =
      this.configService.get<string>("SUPABASE_SESSIONS_TABLE") || "sessions";
  }

  getClient() {
    return this.client;
  }

  getBucketName() {
    return this.bucketName;
  }

  getTasksTableName() {
    return this.tasksTableName;
  }

  getSessionsTableName() {
    return this.sessionsTableName;
  }

  async findFile(fileName: string) {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .list("", { search: fileName });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  async uploadFile(filePath: string, buffer: Buffer, contentType: string) {
    const { error } = await this.client.storage
      .from(this.bucketName)
      .upload(filePath, buffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw error;
    }
  }

  getPublicUrl(filePath: string) {
    const { data } = this.client.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);
    return data.publicUrl;
  }
}
