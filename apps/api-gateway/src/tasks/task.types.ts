import { TaskStatus } from "../common/task-status";

export interface TaskRecord {
  job_id: string;
  session_id: string;
  image_url: string;
  status: TaskStatus;
  question?: string | null;
  mask_all_overlay?: string | null;
  metrics?: Record<string, any> | null;
  vlm_analysis?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  segmentation_callback_at?: Date | string | null;
  vlm_callback_at?: Date | string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

export interface SessionHistoryItem {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface SessionRecord {
  session_id: string;
  job_id: string;
  context: Record<string, unknown>;
  history: SessionHistoryItem[];
  last_question?: string | null;
  last_reply?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
