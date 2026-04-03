import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

@Injectable()
export class SegmentationClient {
  private readonly logger = new Logger(SegmentationClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async trigger(jobId: string, callbackUrl: string) {
    const endpoint = this.configService.get<string>("SEGMENT_SERVICE_URL");

    if (!endpoint) {
      throw new Error("SEGMENT_SERVICE_URL is missing");
    }

    const payload = {
      job_id: jobId,
      callback_url: callbackUrl,
    };

    const candidates = this.buildEndpointCandidates(endpoint);
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        this.logger.log(`Triggering segmentation for ${jobId} via ${candidate}`);
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
          `Segmentation endpoint returned 404 for ${candidate}. Retrying fallback endpoint...`,
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Segmentation request failed");
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
        parsed.pathname = "/inference";
        const fallback = parsed.toString();
        if (!candidates.includes(fallback)) {
          candidates.push(fallback);
        }
      }
      return candidates;
    } catch {
      if (!/\/inference\/?$/.test(sanitized)) {
        const fallback = `${sanitized.replace(/\/+$/, "")}/inference`;
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
