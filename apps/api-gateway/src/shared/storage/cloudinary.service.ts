import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";

@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>("CLOUDINARY_CLOUD_NAME"),
      api_key: this.configService.get<string>("CLOUDINARY_API_KEY"),
      api_secret: this.configService.get<string>("CLOUDINARY_API_SECRET"),
    });
  }

  async uploadFile(buffer: Buffer, fileName?: string): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "floodai",
          public_id: fileName?.split(".")[0], // Use filename without extension as public_id
          resource_type: "auto",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );

      uploadStream.end(buffer);
    });
  }

  async findFile(fileName: string) {
    try {
      const result = await cloudinary.search
        .expression(`public_id:floodai/${fileName.split(".")[0]}`)
        .execute();
      return result.resources || [];
    } catch (error) {
      return [];
    }
  }

  getPublicUrl(publicId: string) {
    return cloudinary.url(publicId);
  }
}
