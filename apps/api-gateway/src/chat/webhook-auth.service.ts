import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class WebhookAuthService {
  constructor(private readonly configService: ConfigService) {}

  assertAuthorized(headerSecret?: string, querySecret?: string) {
    const configuredSecret =
      this.configService.get<string>("WORKER_WEBHOOK_SECRET") ||
      this.configService.get<string>("WEBHOOK_SECRET");

    if (!configuredSecret) {
      return;
    }

    if (headerSecret === configuredSecret || querySecret === configuredSecret) {
      return;
    }

    throw new UnauthorizedException("Invalid webhook secret");
  }
}
