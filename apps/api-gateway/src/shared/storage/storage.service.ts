import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class SharedStorageService {
  private readonly uploadsDir: string;
  private readonly baseUrl: string;
  private readonly originalsPrefix: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadsDir =
      this.configService.get<string>("UPLOADS_DIR") ||
      path.join(process.cwd(), "uploads");
    this.baseUrl =
      this.configService.get<string>("GATEWAY_BASE_URL") ||
      "http://localhost:5000";
    this.originalsPrefix =
      this.configService.get<string>("SUPABASE_ORIGINALS_PREFIX") ||
      "originals";

    fs.mkdirSync(path.join(this.uploadsDir, this.originalsPrefix), {
      recursive: true,
    });
  }

  getBucketName() {
    return "local";
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
  ): Promise<{ name: string }[]> {
    const fullPath = path.join(this.uploadsDir, prefix, fileName);
    return fs.existsSync(fullPath) ? [{ name: fileName }] : [];
  }

  async uploadFile(filePath: string, buffer: Buffer, _contentType: string) {
    const fullPath = path.join(this.uploadsDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (fs.existsSync(fullPath)) {
      throw new Error(`File already exists: ${filePath}`);
    }
    fs.writeFileSync(fullPath, buffer);
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
    return `${this.baseUrl}/uploads/${filePath}`;
  }

  private isAlreadyExistsError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /already exists/i.test(message);
  }
}
