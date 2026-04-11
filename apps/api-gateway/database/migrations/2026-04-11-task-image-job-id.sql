begin;

create table if not exists public.task_image_new (
  job_id uuid primary key references public.task_reasoning (job_id) on delete cascade,
  session_id uuid not null references public.sessions (session_id) on delete cascade,
  image_url text not null,
  status text not null check (
    status in (
      'queued',
      'processing_segmentation',
      'success_segmentation',
      'error'
    )
  ),
  mask_all_overlay text null,
  metrics jsonb null,
  error_code text null,
  error_message text null,
  segmentation_callback_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.task_image_new (
  job_id,
  session_id,
  image_url,
  status,
  mask_all_overlay,
  metrics,
  error_code,
  error_message,
  segmentation_callback_at,
  created_at,
  updated_at
)
select
  tr.job_id,
  legacy.session_id,
  legacy.image_url,
  legacy.status,
  legacy.mask_all_overlay,
  legacy.metrics,
  legacy.error_code,
  legacy.error_message,
  legacy.segmentation_callback_at,
  coalesce(legacy.created_at, tr.created_at, now()),
  coalesce(legacy.updated_at, tr.updated_at, now())
from public.task_reasoning tr
join public.task_image legacy on legacy.session_id = tr.session_id
on conflict (job_id) do nothing;

drop table public.task_image;
alter table public.task_image_new rename to task_image;

create index if not exists idx_task_image_session_id on public.task_image (session_id);

commit;
