import { Session } from "./session.entity";
export { TaskStatus } from "../../common/task-status";
import { TaskStatus } from "../../common/task-status";
export declare class Task {
    job_id: string;
    session_id: string;
    session: Session;
    image_url: string;
    status: TaskStatus;
    question: string;
    mask_all_overlay: string;
    vlm_analysis: string;
    error_code: string;
    error_message: string;
    segmentation_callback_at: Date;
    vlm_callback_at: Date;
    created_at: Date;
    updated_at: Date;
}
