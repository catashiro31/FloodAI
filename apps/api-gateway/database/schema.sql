create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  session_id uuid primary key default gen_random_uuid(),
  context jsonb not null default '{}'::jsonb,
  last_question text null,
  last_reply text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_image (
  session_id uuid primary key references public.sessions (session_id) on delete cascade,
  image_url text not null,
  status text not null check (
    status in (
      'queued',
      'processing_segmentation',
      'success_segmentation',
      'error'
    )
  ),
  mask_url text null,
  metrics jsonb null,
  error_code text null,
  error_message text null,
  segmentation_callback_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_reasoning (
  job_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (session_id) on delete cascade,
  status text not null check (
    status in (
      'queued',
      'processing_segmentation',
      'success_segmentation',
      'processing_vlm',
      'success_vlm',
      'error'
  )
  ),
  question text null,
  image_url text not null,
  mask_url text null,
  vlm_analysis text null,
  error_code text null,
  error_message text null,
  vlm_callback_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.session_history (
  history_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (session_id) on delete cascade,
  reasoning_task_id uuid null references public.task_reasoning (job_id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  image_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_reasoning_session_id on public.task_reasoning (session_id);
create index if not exists idx_task_reasoning_status on public.task_reasoning (status);
create index if not exists idx_task_image_session_id on public.task_image (session_id);
create index if not exists idx_session_history_session_id on public.session_history (session_id);
create index if not exists idx_session_history_reasoning_task_id on public.session_history (reasoning_task_id);
create index if not exists idx_sessions_updated_at on public.sessions (updated_at desc);
