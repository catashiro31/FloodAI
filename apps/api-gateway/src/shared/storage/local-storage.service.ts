import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class LocalStorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly uploadDir: string;

  constructor() {
    // Thư mục uploads nằm cạnh thư mục src
    this.uploadDir = path.resolve(process.cwd(), "uploads");
    this.ensureDirectories();
  }

  private ensureDirectories() {
    const dirs = [
      this.uploadDir,
      path.join(this.uploadDir, "originals"),
      path.join(this.uploadDir, "masks"),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`Created directory: ${dir}`);
      }
    }
  }

  /**
   * Lưu file ảnh gốc vào thư mục cục bộ.
   * @returns URL tương đối dùng để truy cập qua HTTP static (ví dụ: /static/originals/abc.png)
   */
  async saveFile(buffer: Buffer, fileName: string): Promise<{ secure_url: string }> {
    const filePath = path.join(this.uploadDir, "originals", fileName);
    fs.writeFileSync(filePath, buffer);
    this.logger.log(`Saved original: ${filePath}`);
    return { secure_url: `/static/originals/${fileName}` };
  }

  /**
   * Lưu ảnh mask từ base64 content.
   * @returns URL tương đối (ví dụ: /static/masks/jobid_mask.png)
   */
  async saveMask(base64Content: string, maskFileName: string): Promise<string> {
    const filePath = path.join(this.uploadDir, "masks", maskFileName);
    const buffer = Buffer.from(base64Content, "base64");
    fs.writeFileSync(filePath, buffer);
    this.logger.log(`Saved mask: ${filePath}`);
    return `/static/masks/${maskFileName}`;
  }

  /**
   * Kiểm tra file đã tồn tại chưa (dùng cho dedup ảnh gốc).
   */
  async findFile(fileName: string): Promise<{ secure_url: string }[]> {
    const filePath = path.join(this.uploadDir, "originals", fileName);
    if (fs.existsSync(filePath)) {
      return [{ secure_url: `/static/originals/${fileName}` }];
    }
    return [];
  }

  /**
   * Trả về đường dẫn tuyệt đối trên disk cho file.
   */
  getAbsolutePath(relativePath: string): string {
    // relativePath dạng /static/originals/abc.png → uploads/originals/abc.png
    const cleaned = relativePath.replace(/^\/static\//, "");
    return path.join(this.uploadDir, cleaned);
  }

  /**
   * Đọc file từ disk và trả về Buffer.
   */
  readFileBuffer(relativePath: string): Buffer {
    const absPath = this.getAbsolutePath(relativePath);
    return fs.readFileSync(absPath);
  }
}
