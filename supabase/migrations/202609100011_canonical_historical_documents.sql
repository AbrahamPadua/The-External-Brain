-- Canonical historical initiative import.
--
-- Historical initiatives belong in public.initiatives so that, once a real
-- approved lead is explicitly chosen during the import, they enter the same
-- catalog and future open_cycle calls create ordinary live RM/review
-- obligations.  The old records themselves are documents, not obligations:
-- assigning them cycles, deadlines, HP events, or invented profiles would
-- misrepresent the Notion history and could affect the live workflow.
--
-- One source week is represented by one historical RM and, when the source
-- contains reviews for that week's RMs, one historical review.  The review
-- points at that compiled RM using the normal documents relationship.  This
-- deliberately leaves obligations' unique(cycle_id, initiative_id, kind)
-- invariant intact: it is the correct one-live-RM/one-live-review rule.
--
-- Do not drop historical_imports here.  The preview must remain recoverable
-- until the canonical import has been reconciled and accepted.

alter table public.initiatives
  add column if not exists historical_source_key text;

create unique index if not exists initiatives_historical_source_key_unique
  on public.initiatives (historical_source_key)
  where historical_source_key is not null;

alter table public.initiatives
  drop constraint if exists initiatives_historical_source_key_present;
alter table public.initiatives
  add constraint initiatives_historical_source_key_present
  check (historical_source_key is null or btrim(historical_source_key) <> '') not valid;
alter table public.initiatives validate constraint initiatives_historical_source_key_present;

-- A historical document has no live obligation and no application author.
-- Every live document continues to require both, so existing submit/draft/RM
-- RPCs remain on their current path.
alter table public.documents
  alter column obligation_id drop not null,
  alter column author_id drop not null,
  add column if not exists is_historical_import boolean not null default false,
  add column if not exists historical_source_key text;

create unique index if not exists documents_historical_source_key_unique
  on public.documents (historical_source_key)
  where is_historical_import;

alter table public.documents
  drop constraint if exists documents_historical_import_shape;
alter table public.documents
  add constraint documents_historical_import_shape check (
    (
      is_historical_import
      and obligation_id is null
      and author_id is null
      and historical_source_key is not null
      and btrim(historical_source_key) <> ''
    )
    or (
      not is_historical_import
      and obligation_id is not null
      and author_id is not null
      and historical_source_key is null
    )
  ) not valid;
alter table public.documents validate constraint documents_historical_import_shape;

-- The original author is provenance, not an account on The External Brain.  A null value
-- means the source did not identify an author; no identity is fabricated.
alter table public.document_versions
  alter column created_by drop not null;

create or replace function public.validate_historical_document()
returns trigger language plpgsql set search_path = public as $$
declare
  target public.documents%rowtype;
begin
  if tg_op = 'UPDATE' and old.is_historical_import then
    raise exception 'historical documents are immutable';
  end if;
  if new.is_historical_import then
    if new.kind = 'rm' and new.reviewed_document_id is not null then
      raise exception 'historical RM cannot review another document';
    end if;
    if new.kind = 'review' then
      if new.reviewed_document_id is null or new.reviewed_version_number <> 1 then
        raise exception 'historical review must reference compiled RM version 1';
      end if;
      select * into target from public.documents where id = new.reviewed_document_id;
      if not found
        or not target.is_historical_import
        or target.kind <> 'rm'
        or target.initiative_id <> new.initiative_id
        or target.submitted_version_number <> 1 then
        raise exception 'historical review target must be a submitted historical RM in the same initiative';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.validate_historical_document_version()
returns trigger language plpgsql set search_path = public as $$
declare
  doc public.documents%rowtype;
begin
  select * into doc from public.documents where id = new.document_id;
  if not found then
    raise exception 'document not found';
  end if;
  if doc.is_historical_import then
    -- The Notion capture has no reliable submission timestamp.  Keep it null
    -- rather than setting an import-time value that looks historical.
    if new.version_number <> 1 or new.created_by is not null then
      raise exception 'historical documents require one authorless version';
    end if;
    if jsonb_typeof(new.content) <> 'object'
      or jsonb_typeof(new.content->'blocks') <> 'array'
      or coalesce(new.content->>'historical', '') <> 'true'
      or new.content->>'source_key' is distinct from doc.historical_source_key
      or coalesce(jsonb_typeof(new.content->'source_author'), '') not in ('string', 'null')
      or coalesce(jsonb_typeof(new.content->'source_period'), '') not in ('string', 'null')
      or coalesce(jsonb_typeof(new.content->'source_week'), '') <> 'string'
      or btrim(new.content->>'source_week') = ''
      or jsonb_typeof(new.content->'source_record_count') <> 'number'
      or coalesce(new.content->>'source_record_count', '') !~ '^[1-9][0-9]*$' then
      raise exception 'historical document version has invalid provenance';
    end if;
    if doc.kind = 'review' and not exists (
      select 1 from public.document_versions target
      where target.document_id = doc.reviewed_document_id
        and target.version_number = doc.reviewed_version_number
    ) then
      raise exception 'historical review target version is missing';
    end if;
  elsif new.created_by is null then
    raise exception 'live document versions require an author';
  end if;
  return new;
end $$;

drop trigger if exists historical_document_integrity on public.documents;
create trigger historical_document_integrity
  before insert or update on public.documents
  for each row execute function public.validate_historical_document();

drop trigger if exists historical_document_version_integrity on public.document_versions;
create trigger historical_document_version_integrity
  before insert on public.document_versions
  for each row execute function public.validate_historical_document_version();

-- Tables are already RPC-only to anon/authenticated (202609090004).  Make the
-- intended boundary explicit for this post-004 migration as well: import SQL
-- runs in the Supabase SQL editor; clients receive SELECT and the existing
-- read-only submission history, never direct historical writes.
revoke insert, update, delete on public.initiatives, public.documents, public.document_versions from anon, authenticated;

-- New trigger functions are implementation details, not client commands.
revoke all on function public.validate_historical_document() from public, anon, authenticated;
revoke all on function public.validate_historical_document_version() from public, anon, authenticated;
