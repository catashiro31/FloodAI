import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
export declare class VlmClient {
    private readonly httpService;
    private readonly configService;
    private readonly logger;
    constructor(httpService: HttpService, configService: ConfigService);
    trigger(jobId: string, sessionId: string, question: string, callbackUrl: string, reset?: boolean): Promise<any>;
    private isNotFound;
    private buildEndpointCandidates;
    private sanitizeEndpoint;
}
