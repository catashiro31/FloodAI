import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
export declare class SegmentationClient {
    private readonly httpService;
    private readonly configService;
    private readonly logger;
    constructor(httpService: HttpService, configService: ConfigService);
    trigger(jobId: string, callbackUrl: string): Promise<any>;
    private isNotFound;
    private buildEndpointCandidates;
    private sanitizeEndpoint;
}
