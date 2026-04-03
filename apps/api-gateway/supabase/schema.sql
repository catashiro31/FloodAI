create extension if not exists "pgcrypto";

create table if not exists public.tasks (
  job_id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  image_url text not null,
  status text not null check (
    status in (
      'queued',
      'processing(segmentation)',
      'success(segmentation)',
      'processing(vlm)',
      'success(vlm)',
      'error'
    )
  ),
  question text null,
  mask_all_overlay text null,
  vlm_analysis text null,
  error_code text null,
  error_message text null,
  segmentation_callback_at timestamptz null,
  vlm_callback_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  session_id uuid primary key,
  job_id uuid not null references public.tasks (job_id) on delete cascade,
  context jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  last_question text null,
  last_reply text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_session_id on public.tasks (session_id);
create index if not exists idx_tasks_status_created_at on public.tasks (status, created_at desc);
create index if not exists idx_sessions_job_id on public.sessions (job_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tasks_set_updated_at on public.tasks;
create trigger trg_tasks_set_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

drop trigger if exists trg_sessions_set_updated_at on public.sessions;
create trigger trg_sessions_set_updated_at
before update on public.sessions
for each row
execute function public.set_updated_at();
