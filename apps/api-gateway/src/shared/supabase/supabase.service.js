"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedSupabaseService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const supabase_js_1 = require("@supabase/supabase-js");
let SharedSupabaseService = class SharedSupabaseService {
    constructor(configService) {
        this.configService = configService;
        const supabaseUrl = this.configService.get("SUPABASE_URL");
        const supabaseKey = this.configService.get("SUPABASE_KEY");
        if (!supabaseUrl || !supabaseKey) {
            throw new Error("SUPABASE_URL and SUPABASE_KEY must be configured");
        }
        this.client = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        this.bucketName =
            this.configService.get("SUPABASE_IMAGES_BUCKET") ||
                this.configService.get("SUPABASE_BUCKET") ||
                "images";
        this.tasksTableName =
            this.configService.get("SUPABASE_TASKS_TABLE") || "tasks";
        this.sessionsTableName =
            this.configService.get("SUPABASE_SESSIONS_TABLE") || "sessions";
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
    async findFile(fileName) {
        const { data, error } = await this.client.storage
            .from(this.bucketName)
            .list("", { search: fileName });
        if (error) {
            throw error;
        }
        return data !== null && data !== void 0 ? data : [];
    }
    async uploadFile(filePath, buffer, contentType) {
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
    getPublicUrl(filePath) {
        const { data } = this.client.storage
            .from(this.bucketName)
            .getPublicUrl(filePath);
        return data.publicUrl;
    }
};
exports.SharedSupabaseService = SharedSupabaseService;
exports.SharedSupabaseService = SharedSupabaseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SharedSupabaseService);
//# sourceMappingURL=supabase.service.js.map