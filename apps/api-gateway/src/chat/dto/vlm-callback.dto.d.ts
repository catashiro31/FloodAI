import { SessionHistoryItem } from "../../tasks/task.types";
export declare class VlmCallbackDto {
    job_id: string;
    session_id: string;
    status: string;
    reply?: string;
    context?: Record<string, unknown>;
    history?: SessionHistoryItem[];
    error_code?: string;
    error_message?: string;
}
