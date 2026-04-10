import { TaskStatus } from "../common/task-status";

export interface ImageTaskRecord {
  job_id: string;
  session_id: string;
  image_url: string;
  status: TaskStatus;
  mask_all_overlay?: string | null;
  metrics?: Record<string, any> | null;
  error_code?: string | null;
  error_message?: string | null;
  segmentation_callback_at?: Date | string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

export interface ReasoningTaskRecord {
  job_id: string;
  session_id: string;
  status: TaskStatus;
  question?: string | null;
  vlm_analysis?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  vlm_callback_at?: Date | string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

export interface TaskRecord extends ReasoningTaskRecord {
  image_url: string | null;
  mask_all_overlay?: string | null;
  metrics?: Record<string, any> | null;
  image_status?: TaskStatus | null;
  segmentation_callback_at?: Date | string | null;
}

export interface SessionHistoryRecord {
  history_id?: string;
  session_id: string;
  reasoning_task_id?: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  image_urls?: string[];
}

export interface SessionRecord {
  session_id: string;
  context: Record<string, unknown>;
  last_question?: string | null;
  last_reply?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  image_task?: ImageTaskRecord | null;
  reasoning_tasks?: ReasoningTaskRecord[];
  history?: SessionHistoryRecord[];
  history_count?: number;
}
