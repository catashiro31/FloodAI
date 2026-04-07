-- 1. Định nghĩa kiểu ENUM cho trạng thái (Tường minh hơn)
CREATE TYPE public.task_status AS ENUM (
  'queued',
  'processing_segmentation',
  'success_segmentation',
  'processing_vlm',
  'success_vlm',
  'error'
);

-- 2. Cập nhật bảng Sessions (Thêm user_id, giữ last_question/reply phục vụ preview)
CREATE TABLE IF NOT EXISTS public.sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NULL, -- Thêm cột này (có thể đổi thành uuid REFERENCES users nếu có bảng users)
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_question text NULL, -- Giữ lại nếu cần làm Sidebar hiển thị preview
  last_reply text NULL,    -- Giữ lại nếu cần làm Sidebar hiển thị preview
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index để tìm nhanh session của một user cụ thể
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions (user_id);

-- 3. Cập nhật bảng Tasks (Sử dụng ENUM)
CREATE TABLE IF NOT EXISTS public.tasks (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions (session_id) ON DELETE CASCADE,
  image_url text NOT NULL,
  status public.task_status NOT NULL DEFAULT 'queued', -- Dùng kiểu ENUM và set mặc định
  question text NULL,
  mask_all_overlay text NULL,
  vlm_analysis text NULL,
  error_code text NULL,
  error_message text NULL,
  segmentation_callback_at timestamptz NULL,
  vlm_callback_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);