import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

@Injectable()
export class VlmClient {
  private readonly logger = new Logger(VlmClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async trigger(
    jobId: string,
    sessionId: string,
    question: string,
    callbackUrl: string,
    reset = false,
  ) {
    const endpoint = this.configService.get<string>("VLM_SERVICE_URL");

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
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        this.logger.log(`Triggering VLM for ${jobId} via ${candidate}`);
        const response = await firstValueFrom(
          this.httpService.post(candidate, payload),
        );
        return response.data;
      } catch (error) {
        lastError = error;
        const isLastCandidate = candidate === candidates[candidates.length - 1];
        if (!this.isNotFound(error) || isLastCandidate) {
          throw error;
        }
        this.logger.warn(
          `VLM endpoint returned 404 for ${candidate}. Retrying fallback endpoint...`,
        );
      }
    }

    throw lastError instanceof Error ? lastError : new Error("VLM request failed");
  }

  private isNotFound(error: unknown): boolean {
    const status = (error as { response?: { status?: number } })?.response?.status;
    return status === 404;
  }

  private buildEndpointCandidates(endpoint: string): string[] {
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
    } catch {
      if (!/\/reasoning\/?$/.test(sanitized)) {
        const fallback = `${sanitized.replace(/\/+$/, "")}/reasoning`;
        if (!candidates.includes(fallback)) {
          candidates.push(fallback);
        }
      }
      return candidates;
    }
  }

  private sanitizeEndpoint(endpoint: string): string {
    return endpoint.replace(/\s+/g, "").trim();
  }
}
