import { ConfigService } from "@nestjs/config";
import { SupabaseClient } from "@supabase/supabase-js";
export declare class SharedSupabaseService {
    private readonly configService;
    private readonly client;
    private readonly bucketName;
    private readonly tasksTableName;
    private readonly sessionsTableName;
    constructor(configService: ConfigService);
    getClient(): SupabaseClient<any, "public", "public", any, any>;
    getBucketName(): string;
    getTasksTableName(): string;
    getSessionsTableName(): string;
    findFile(fileName: string): Promise<import("@supabase/storage-js").FileObject[]>;
    uploadFile(filePath: string, buffer: Buffer, contentType: string): Promise<void>;
    getPublicUrl(filePath: string): string;
}
