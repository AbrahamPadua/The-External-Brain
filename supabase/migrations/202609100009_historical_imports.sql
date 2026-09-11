-- Read-only historical initiative previews. These records deliberately have no
-- foreign keys to profiles, initiatives, obligations, tasks, documents or HP.
create table public.historical_imports (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  title text not null,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  constraint historical_imports_title_present check (btrim(title) <> ''),
  constraint historical_imports_source_key_present check (btrim(source_key) <> ''),
  constraint historical_imports_payload_sections check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'sections') = 'array'
  )
);

alter table public.historical_imports enable row level security;

create policy historical_imports_approved_read
on public.historical_imports for select
to authenticated
using (public.is_approved());

revoke all on table public.historical_imports from public, anon, authenticated;
grant select on table public.historical_imports to authenticated;
