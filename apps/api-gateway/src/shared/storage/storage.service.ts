import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

interface SupabaseStorageFile {
  name: string;
}

@Injectable()
export class SharedStorageService {
  private readonly client: SupabaseClient;
  private readonly bucketName: string;
  private readonly originalsPrefix: string;

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

    this.bucketName =
      this.configService.get<string>("SUPABASE_IMAGES_BUCKET") ||
      this.configService.get<string>("SUPABASE_BUCKET") ||
      "images";
    this.originalsPrefix =
      this.configService.get<string>("SUPABASE_ORIGINALS_PREFIX") ||
      "originals";
  }

  getBucketName() {
    return this.bucketName;
  }

  getOriginalsPrefix() {
    return this.originalsPrefix;
  }

  buildStoragePath(fileName: string, prefix = this.originalsPrefix) {
    return `${prefix}/${fileName}`;
  }

  async findFile(
    fileName: string,
    prefix = this.originalsPrefix,
  ): Promise<SupabaseStorageFile[]> {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .list(prefix, { search: fileName, limit: 10 });

    if (error) {
      throw error;
    }

    return (data ?? []).filter((file) => file.name === fileName);
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

  async ensureFile(
    filePath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    try {
      await this.uploadFile(filePath, buffer, contentType);
    } catch (error) {
      if (!this.isAlreadyExistsError(error)) {
        throw error;
      }
    }

    return this.getPublicUrl(filePath);
  }

  getPublicUrl(filePath: string) {
    const { data } = this.client.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);
    return data.publicUrl;
  }

  private isAlreadyExistsError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /already exists/i.test(message);
  }
}
