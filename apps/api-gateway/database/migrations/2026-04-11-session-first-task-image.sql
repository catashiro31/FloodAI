begin;

alter table public.task_reasoning
  add column if not exists image_url text;

alter table public.task_reasoning
  add column if not exists mask_url text null;

update public.task_reasoning tr
set image_url = ti.image_url
from public.task_image ti
where tr.session_id = ti.session_id
  and tr.image_url is null;

update public.task_reasoning
set image_url = ''
where image_url is null;

alter table public.task_reasoning
  alter column image_url set not null;

alter table public.task_image
  add column if not exists mask_url text null;

update public.task_image
set mask_url = mask_all_overlay
where mask_url is null
  and mask_all_overlay is not null;

create table if not exists public.task_image_session (
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

insert into public.task_image_session (
  session_id,
  image_url,
  status,
  mask_url,
  metrics,
  error_code,
  error_message,
  segmentation_callback_at,
  created_at,
  updated_at
)
select distinct on (ti.session_id)
  ti.session_id,
  ti.image_url,
  ti.status,
  ti.mask_url,
  ti.metrics,
  ti.error_code,
  ti.error_message,
  ti.segmentation_callback_at,
  coalesce(ti.created_at, now()),
  coalesce(ti.updated_at, now())
from public.task_image ti
order by ti.session_id, ti.updated_at desc nulls last, ti.created_at desc nulls last
on conflict (session_id) do update
set
  image_url = excluded.image_url,
  status = excluded.status,
  mask_url = excluded.mask_url,
  metrics = excluded.metrics,
  error_code = excluded.error_code,
  error_message = excluded.error_message,
  segmentation_callback_at = excluded.segmentation_callback_at,
  updated_at = excluded.updated_at;

update public.task_reasoning tr
set
  image_url = tis.image_url,
  mask_url = tis.mask_url
from public.task_image_session tis
where tr.session_id = tis.session_id;

drop table if exists public.task_image;
alter table public.task_image_session rename to task_image;

create index if not exists idx_task_image_session_id on public.task_image (session_id);

commit;
