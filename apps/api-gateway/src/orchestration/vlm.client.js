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
var VlmClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VlmClient = void 0;
const axios_1 = require("@nestjs/axios");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
let VlmClient = VlmClient_1 = class VlmClient {
    constructor(httpService, configService) {
        this.httpService = httpService;
        this.configService = configService;
        this.logger = new common_1.Logger(VlmClient_1.name);
    }
    async trigger(jobId, sessionId, question, callbackUrl, reset = false) {
        const endpoint = this.configService.get("VLM_SERVICE_URL");
        if (!endpoint) {
            throw new Error("VLM_SERVICE_URL is missing");
        }
        const payload = {
            job_id: jobId,
            session_id: sessionId,
            question,
            callback_url: callbackUrl,
            reset,
        };
        const candidates = this.buildEndpointCandidates(endpoint);
        let lastError;
        for (const candidate of candidates) {
            try {
                this.logger.log(`Triggering VLM for ${jobId} via ${candidate}`);
                const response = await (0, rxjs_1.firstValueFrom)(this.httpService.post(candidate, payload));
                return response.data;
            }
            catch (error) {
                lastError = error;
                const isLastCandidate = candidate === candidates[candidates.length - 1];
                if (!this.isNotFound(error) || isLastCandidate) {
                    throw error;
                }
                this.logger.warn(`VLM endpoint returned 404 for ${candidate}. Retrying fallback endpoint...`);
            }
        }
        throw lastError instanceof Error ? lastError : new Error("VLM request failed");
    }
    isNotFound(error) {
        var _a;
        const status = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
        return status === 404;
    }
    buildEndpointCandidates(endpoint) {
        const sanitized = this.sanitizeEndpoint(endpoint);
        const candidates = [sanitized];
        try {
            const parsed = new URL(sanitized);
            const normalizedPath = parsed.pathname.replace(/\/+$/, "");
            if (!normalizedPath) {
                parsed.pathname = "/reasoning";
                const fallback = parsed.toString();
                if (!candidates.includes(fallback)) {
                    candidates.push(fallback);
                }
            }
            return candidates;
        }
        catch (_a) {
            if (!/\/reasoning\/?$/.test(sanitized)) {
                const fallback = `${sanitized.replace(/\/+$/, "")}/reasoning`;
                if (!candidates.includes(fallback)) {
                    candidates.push(fallback);
                }
            }
            return candidates;
        }
    }
    sanitizeEndpoint(endpoint) {
        return endpoint.replace(/\s+/g, "").trim();
    }
};
exports.VlmClient = VlmClient;
exports.VlmClient = VlmClient = VlmClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], VlmClient);
//# sourceMappingURL=vlm.client.js.map