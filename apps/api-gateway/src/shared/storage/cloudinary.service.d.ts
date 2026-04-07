import { ConfigService } from "@nestjs/config";
import { UploadApiResponse } from "cloudinary";
export declare class CloudinaryService {
    private readonly configService;
    constructor(configService: ConfigService);
    uploadFile(buffer: Buffer, fileName?: string): Promise<UploadApiResponse>;
    findFile(fileName: string): Promise<any>;
    getPublicUrl(publicId: string): string;
}
