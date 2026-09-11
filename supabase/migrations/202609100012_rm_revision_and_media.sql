-- 202609100012 RM revision, proposal motivation, and initiative media.
--
-- Four additions, all backend-only. This migration is not yet applied to any
-- project.
--
-- 1. public.count_words + a >= 150 word "motivation" gate on proposal
--    submission (save_proposal p_submit=true) and on approval (decide_proposal
--    p_status='approved'). Drafts are never checked. Already-approved
--    initiatives and the direct historical-import INSERT path are untouched, so
--    legacy projects are not blocked; the re-approve idempotency branch in
--    decide_proposal returns the existing initiative before the new check.
--
-- 2. public.revise_rm: a Research-only, audited revision of ANY reporting memo,
--    live or historical. It appends a new, attributed document_versions row and
--    never rewrites an existing one, so original versions, timestamps and
--    historical provenance are preserved. It inserts no hp_events and touches no
--    obligation, review, membership or role, so no reward/penalty is duplicated.
--    For a live RM it may also re-point documents.author_id at another approved
--    account. For a historical RM the account author stays null (no fabricated
--    identity) and attribution is carried in the version's source_author.
--
-- 3. Initiative cover image/GIF with a colour fallback: four nullable columns on
--    initiatives, a private 'initiative-covers' bucket whose read audience is
--    every approved account, and set/clear/colour RPCs limited to the lead or an
--    admin. Covers are deliberately absent from the anon initiative_catalog
--    view.
--
-- 4. Inline RM images as document-linked metadata: public.document_attachments
--    plus attach/detach RPCs, and a re-scoped 'initiative-images' read policy.
--    A submitted (or historical) RM's images are visible to any approved
--    account; a draft RM's images only to accounts that can edit that RM
--    (its team, or Research). Objects with no attachment row keep the
--    202609100007 per-initiative rule. MIME and byte-size are bounded in the
--    RPCs and as CHECK constraints; the buckets also carry file_size_limit /
--    allowed_mime_types where the Supabase columns exist. No bucket is public.

-- ---------------------------------------------------------------------------
-- 1. Motivation word count
-- ---------------------------------------------------------------------------

-- Whitespace-run tokenisation, matching the JS
--   s.trim() === '' ? 0 : s.trim().split(/\s+/).length
create or replace function public.count_words(p_text text)
returns integer language sql immutable set search_path = '' as $$
  select case
    when btrim(coalesce(p_text, '')) = '' then 0
    else cardinality(regexp_split_to_array(btrim(p_text), '\s+'))
  end
$$;

-- Same signature as 202609090003 so its grant and ownership are kept.
create or replace function public.save_proposal(p_title text,p_summary text,p_content jsonb,p_submit boolean default false,p_id uuid default null) returns uuid language plpgsql security definer set search_path=public as $$ declare pid uuid; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 if p_submit and (length(trim(p_title))=0 or length(trim(p_summary))=0) then raise exception 'title and abstract required'; end if;
 if p_submit and public.count_words(p_content->>'motivation') < 150 then
   raise exception 'motivation must be at least 150 words to submit (currently %)', public.count_words(p_content->>'motivation');
 end if;
 if p_submit and char_length(coalesce(p_content->>'motivation','')) > 20000 then
   raise exception 'motivation must be 20000 characters or fewer';
 end if;
 if p_id is null then insert into proposals(author_id,title,summary,content,status) values(auth.uid(),p_title,p_summary,p_content,case when p_submit then 'submitted'::proposal_status else 'draft'::proposal_status end) returning id into pid;
 else update proposals set title=p_title,summary=p_summary,content=p_content,status=case when p_submit then 'submitted'::proposal_status else 'draft'::proposal_status end,updated_at=now() where id=p_id and author_id=auth.uid() and status in ('draft','changes_requested') returning id into pid; if pid is null then raise exception 'proposal is not editable'; end if; end if;
 perform audit('proposal_saved','proposal',pid,jsonb_build_object('submitted',p_submit)); return pid; end $$;

-- Same signature as 202609090003. The new check sits after the re-approve
-- idempotency return and the author-approval check, so it only fires on the
-- submitted -> approved transition that actually creates an initiative.
create or replace function public.decide_proposal(p_proposal uuid,p_status public.proposal_status,p_reason text default null) returns uuid language plpgsql security definer set search_path=public as $$ declare p proposals%rowtype; i uuid; begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 if p_status not in ('approved','rejected','changes_requested') then raise exception 'invalid decision'; end if;
 select * into p from proposals where id=p_proposal for update; if not found then raise exception 'unknown proposal'; end if;
 if p.status='approved' and p_status='approved' then select id into i from initiatives where proposal_id=p.id; return i; end if;
 if p.status<>'submitted' then raise exception 'proposal not submitted'; end if;
 if p_status='approved' and not public.is_approved(p.author_id) then raise exception 'author not approved'; end if;
 if p_status='approved' and public.count_words(p.content->>'motivation') < 150 then
   raise exception 'motivation must be at least 150 words before approval (currently %)', public.count_words(p.content->>'motivation');
 end if;
 update proposals set status=p_status,decision_reason=p_reason,decided_by=auth.uid(),decided_at=now() where id=p.id;
 if p_status='approved' then insert into initiatives(proposal_id,title,summary,content,lead_id) values(p.id,p.title,p.summary,p.content,p.author_id) returning id into i; insert into initiative_memberships(initiative_id,user_id,role) values(i,p.author_id,'lead'); end if;
 insert into notifications(user_id,kind,payload) values(p.author_id,'proposal_decided',jsonb_build_object('status',p_status));
 perform audit('proposal_decided','proposal',p.id,jsonb_build_object('status',p_status,'reason',p_reason)); return i; end $$;

-- ---------------------------------------------------------------------------
-- 2. Research revision of any reporting memo
-- ---------------------------------------------------------------------------

-- Relax only the historical version-1 rule: a later version is allowed when it
-- is added through public.revise_rm (which sets openlabs.rm_revision) and it
-- records its editor. Version 1 stays authorless and immutable; the provenance
-- shape check and the review-target check below are unchanged.
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
    if new.version_number = 1 then
      if new.created_by is not null then
        raise exception 'the original historical version must be authorless';
      end if;
    elsif coalesce(current_setting('openlabs.rm_revision', true), '') = '1' then
      if new.created_by is null then
        raise exception 'a historical RM revision must record its editor';
      end if;
    else
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

revoke all on function public.validate_historical_document_version() from public, anon, authenticated;

create function public.revise_rm(
  p_document uuid,
  p_content jsonb,
  p_reason text,
  p_author uuid default null,
  p_source_author text default null,
  p_expected_version integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.documents%rowtype;
  v1 public.document_versions%rowtype;
  v_next integer;
  v_content jsonb;
begin
  if not public.has_role('research') then
    raise exception 'research required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'a revision reason is required';
  end if;
  if coalesce(jsonb_typeof(p_content), '') <> 'object'
    or coalesce(jsonb_typeof(p_content->'blocks'), '') <> 'array' then
    raise exception 'content must be an object with a blocks array';
  end if;

  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'unknown document'; end if;
  if d.kind <> 'rm' then raise exception 'only reporting memos can be revised here'; end if;

  select coalesce(max(version_number), 0) + 1 into v_next
    from public.document_versions where document_id = d.id;
  if p_expected_version is distinct from v_next - 1 then
    raise exception 'revision conflict: reload the latest version before revising';
  end if;

  if d.is_historical_import then
    if p_author is not null then
      raise exception 'historical memos keep a null account author; use p_source_author';
    end if;
    select * into v1 from public.document_versions where document_id = d.id and version_number = 1;
    if not found then raise exception 'historical memo has no original version'; end if;
    -- Carry every provenance key forward; the caller only supplies the body.
    v_content := v1.content || jsonb_build_object(
      'blocks', p_content->'blocks',
      'html', coalesce(p_content->'html', v1.content->'html', to_jsonb(''::text)),
      'title', coalesce(p_content->'title', v1.content->'title'),
      'source_author', to_jsonb(coalesce(p_source_author, v1.content->>'source_author')),
      'revision_of', to_jsonb(1),
      'revised_by', to_jsonb(auth.uid()::text),
      'revised_at', to_jsonb(now()::text),
      'revision_reason', to_jsonb(btrim(p_reason))
    );
    perform set_config('openlabs.rm_revision', '1', true);
    insert into public.document_versions(document_id, version_number, content, submitted_at, created_by)
      values (d.id, v_next, v_content, now(), auth.uid());
    perform set_config('openlabs.rm_revision', '0', true);
    -- The documents row (null author, source key, submitted_version_number = 1,
    -- and the historical review link to version 1) is left untouched.
  else
    if p_source_author is not null then
      raise exception 'p_source_author applies only to historical memos';
    end if;
    if d.submitted_version_number is null then
      raise exception 'only a submitted memo can be revised';
    end if;
    if p_author is not null and not public.is_approved(p_author) then
      raise exception 'the new author must be an approved account';
    end if;
    v_content := p_content || jsonb_build_object(
      'revised_by', to_jsonb(auth.uid()::text),
      'revised_at', to_jsonb(now()::text),
      'revision_reason', to_jsonb(btrim(p_reason))
    );
    insert into public.document_versions(document_id, version_number, content, submitted_at, created_by)
      values (d.id, v_next, v_content, now(), auth.uid());
    update public.documents
      set submitted_version_number = v_next,
          author_id = coalesce(p_author, author_id)
      where id = d.id;
  end if;

  perform public.audit('rm_revised', 'document', d.id, jsonb_build_object(
    'version', v_next,
    'historical', d.is_historical_import,
    'author_changed', p_author is not null,
    'source_author_changed', p_source_author is not null,
    'reason', btrim(p_reason)
  ));
  return d.id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Initiative cover
-- ---------------------------------------------------------------------------

alter table public.initiatives
  add column if not exists cover_object_path text,
  add column if not exists cover_fallback_color text,
  add column if not exists cover_set_by uuid references public.profiles(id),
  add column if not exists cover_set_at timestamptz;

alter table public.initiatives drop constraint if exists initiatives_cover_color_hex;
alter table public.initiatives add constraint initiatives_cover_color_hex
  check (cover_fallback_color is null or cover_fallback_color ~ '^#[0-9A-Fa-f]{6}$') not valid;
alter table public.initiatives validate constraint initiatives_cover_color_hex;

insert into storage.buckets(id, name, public)
  values ('initiative-covers', 'initiative-covers', false)
  on conflict (id) do nothing;

-- Bounds on the bucket itself, only where the Supabase columns exist (the
-- offline PGlite harness models storage.buckets as id/name/public).
do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    execute $q$
      update storage.buckets
        set file_size_limit = 10485760,
            allowed_mime_types = array['image/png','image/jpeg','image/gif','image/webp']
        where id in ('initiative-covers', 'initiative-images')
    $q$;
  end if;
end $do$;

create policy initiative_covers_read on storage.objects for select
  using (bucket_id = 'initiative-covers' and public.is_approved());

create policy initiative_covers_insert on storage.objects for insert with check (
  bucket_id = 'initiative-covers' and public.is_approved()
  and exists (
    select 1 from public.initiatives i
    where i.id::text = (storage.foldername(name))[1]
      and (i.lead_id = auth.uid() or public.is_admin())
  )
);
create policy initiative_covers_update on storage.objects for update using (
  bucket_id = 'initiative-covers' and public.is_approved()
  and exists (
    select 1 from public.initiatives i
    where i.id::text = (storage.foldername(name))[1]
      and (i.lead_id = auth.uid() or public.is_admin())
  )
);
create policy initiative_covers_delete on storage.objects for delete using (
  bucket_id = 'initiative-covers' and public.is_approved()
  and exists (
    select 1 from public.initiatives i
    where i.id::text = (storage.foldername(name))[1]
      and (i.lead_id = auth.uid() or public.is_admin())
  )
);

create function public.set_initiative_cover(p_initiative uuid, p_object_path text, p_mime text, p_bytes bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from initiatives where id = p_initiative and lead_id = auth.uid())) then
    raise exception 'initiative lead or admin required';
  end if;
  if p_mime not in ('image/png','image/jpeg','image/gif','image/webp') then
    raise exception 'unsupported image type %', p_mime;
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760 then
    raise exception 'cover must be between 1 byte and 10 MiB';
  end if;
  if coalesce((storage.foldername(p_object_path))[1], '') <> p_initiative::text then
    raise exception 'cover path must sit under the initiative folder';
  end if;
  update initiatives
    set cover_object_path = p_object_path, cover_set_by = auth.uid(), cover_set_at = now(), updated_at = now()
    where id = p_initiative;
  if not found then raise exception 'unknown initiative'; end if;
  perform public.audit('initiative_cover_set', 'initiative', p_initiative, jsonb_build_object('bytes', p_bytes, 'mime', p_mime));
end $$;

create function public.clear_initiative_cover(p_initiative uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from initiatives where id = p_initiative and lead_id = auth.uid())) then
    raise exception 'initiative lead or admin required';
  end if;
  update initiatives
    set cover_object_path = null, cover_set_by = auth.uid(), cover_set_at = now(), updated_at = now()
    where id = p_initiative;
  if not found then raise exception 'unknown initiative'; end if;
  perform public.audit('initiative_cover_cleared', 'initiative', p_initiative, '{}'::jsonb);
end $$;

create function public.set_initiative_cover_color(p_initiative uuid, p_color text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from initiatives where id = p_initiative and lead_id = auth.uid())) then
    raise exception 'initiative lead or admin required';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'colour must be a #rrggbb hex string';
  end if;
  update initiatives set cover_fallback_color = p_color, updated_at = now() where id = p_initiative;
  if not found then raise exception 'unknown initiative'; end if;
  perform public.audit('initiative_cover_color', 'initiative', p_initiative, jsonb_build_object('color', p_color));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Inline RM image attachments
-- ---------------------------------------------------------------------------

create table public.document_attachments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  bucket_id text not null default 'initiative-images',
  object_path text not null unique,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint document_attachments_mime_ok
    check (mime_type in ('image/png','image/jpeg','image/gif','image/webp')),
  constraint document_attachments_size_ok
    check (byte_size > 0 and byte_size <= 10485760),
  constraint document_attachments_dims_ok
    check ((width is null or width > 0) and (height is null or height > 0))
);
alter table public.document_attachments enable row level security;
create policy document_attachments_read on public.document_attachments for select
  using (public.can_read_document(document_id) or public.has_role('research'));
revoke insert, update, delete on public.document_attachments from anon, authenticated;
grant select on public.document_attachments to authenticated;

-- Storage policies must distinguish a genuinely unlinked object from an
-- attachment the current account is not allowed to inspect.  These helpers
-- read only the linkage and are SECURITY DEFINER so attachment-table RLS
-- cannot make a draft attachment look unlinked and fall through to the legacy
-- folder policy.
create function public.has_rm_image_attachment(p_object_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.document_attachments a where a.object_path = p_object_path
  )
$$;

create function public.can_read_rm_image_attachment(p_object_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1
    from public.document_attachments a
    join public.documents d on d.id = a.document_id
    where a.object_path = p_object_path
      and (
        d.submitted_version_number is not null
        or public.can_edit_document(d.id)
        or public.has_role('research')
      )
  )
$$;

revoke all on function public.has_rm_image_attachment(text),
  public.can_read_rm_image_attachment(text) from public, anon, authenticated;
grant execute on function public.has_rm_image_attachment(text),
  public.can_read_rm_image_attachment(text) to authenticated;

create function public.attach_rm_image(
  p_document uuid, p_object_path text, p_mime text, p_bytes bigint,
  p_width integer default null, p_height integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare d public.documents%rowtype; a uuid; existing public.document_attachments%rowtype; begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  select * into d from public.documents where id = p_document;
  if not found then raise exception 'unknown document'; end if;
  if d.kind <> 'rm' then raise exception 'inline images attach to reporting memos only'; end if;
  if not (public.can_edit_document(d.id) or public.has_role('research')) then
    raise exception 'RM edit access required';
  end if;
  if p_mime not in ('image/png','image/jpeg','image/gif','image/webp') then
    raise exception 'unsupported image type %', p_mime;
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760 then
    raise exception 'image must be between 1 byte and 10 MiB';
  end if;
  if coalesce((storage.foldername(p_object_path))[1], '') <> d.initiative_id::text then
    raise exception 'object path must sit under the initiative folder';
  end if;
  -- A path names one object.  Never let an editor of this document rebind an
  -- object already attached to another document, which could change its RLS
  -- audience (especially from a draft to a submitted memo).
  select * into existing from public.document_attachments
    where object_path = p_object_path for update;
  if found and existing.document_id <> d.id then
    raise exception 'object is already attached to another document';
  end if;
  insert into public.document_attachments(document_id, object_path, mime_type, byte_size, width, height, created_by)
    values (d.id, p_object_path, p_mime, p_bytes, p_width, p_height, auth.uid())
    on conflict (object_path) do update
      set mime_type = excluded.mime_type,
          byte_size = excluded.byte_size, width = excluded.width, height = excluded.height
      where public.document_attachments.document_id = d.id
    returning id into a;
  if a is null then
    raise exception 'object is already attached to another document';
  end if;
  perform public.audit('rm_image_attached', 'document', d.id, jsonb_build_object('attachment', a, 'bytes', p_bytes, 'mime', p_mime));
  return a;
end $$;

create function public.detach_rm_image(p_attachment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.document_attachments%rowtype; begin
  select * into r from public.document_attachments where id = p_attachment;
  if not found then return; end if;
  if not (public.can_edit_document(r.document_id) or public.has_role('research') or r.created_by = auth.uid()) then
    raise exception 'RM edit access required';
  end if;
  -- Detaching removes the object as well, so that an unlinked object cannot fall
  -- back to the broader legacy initiative-folder policy. That makes it a
  -- destructive act, and a stored version is immutable: any version that still
  -- renders this path - including an imported historical version 1 - keeps the
  -- bytes. The reference has to leave those versions first, which for a
  -- historical memo means a revise_rm revision, never an edit of the original.
  if exists (
    select 1 from public.document_versions v
    where v.document_id = r.document_id
      and position(r.object_path in coalesce(v.content->>'html', '')) > 0
  ) then
    raise exception 'a stored version still displays this image; revise those versions first';
  end if;
  delete from storage.objects where bucket_id = r.bucket_id and name = r.object_path;
  delete from public.document_attachments where id = p_attachment;
  perform public.audit('rm_image_detached', 'document', r.document_id, jsonb_build_object('attachment', p_attachment));
end $$;

-- Re-scope the 202609100007 read policy: attachment metadata now says whether an
-- object belongs to a submitted RM (any approved account) or a draft RM (only
-- accounts that can edit it, i.e. its team or Research). Objects with no
-- attachment row keep the previous per-initiative rule.
drop policy if exists initiative_images_read on storage.objects;
create policy initiative_images_read on storage.objects for select using (
  bucket_id = 'initiative-images'
  and public.is_approved()
  and (
    public.can_read_rm_image_attachment(name)
    or (
      not public.has_rm_image_attachment(name)
      and (
        exists (
          select 1 from public.initiative_memberships m
          where m.initiative_id::text = (storage.foldername(name))[1]
            and m.user_id = auth.uid()
            and m.left_at is null
        )
        or exists (
          select 1 from public.obligations o
          join public.documents d2 on d2.id = o.target_document_id
          where o.kind = 'review'
            and o.responsible_user_id = auth.uid()
            and o.status in ('open', 'submitted')
            and d2.initiative_id::text = (storage.foldername(name))[1]
        )
      )
    )
  )
);

-- Uploads: a folder-initiative participant, or Research editing any RM.
drop policy if exists initiative_images_insert on storage.objects;
create policy initiative_images_insert on storage.objects for insert with check (
  bucket_id = 'initiative-images'
  and public.is_approved()
  and (
    public.has_role('research')
    or exists (
      select 1 from public.initiative_memberships m
      where m.initiative_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.left_at is null
    )
  )
);

drop policy if exists initiative_images_delete on storage.objects;
create policy initiative_images_delete on storage.objects for delete using (
  bucket_id = 'initiative-images'
  and public.is_approved()
  and (
    public.has_role('research')
    or exists (
      select 1 from public.initiatives i
      where i.id::text = (storage.foldername(name))[1]
        and (i.lead_id = auth.uid() or public.is_admin())
    )
  )
);

-- ---------------------------------------------------------------------------
-- 5. Grants (203609090003 revoked EXECUTE from every role; re-grant explicitly)
-- ---------------------------------------------------------------------------

revoke all on function
  public.count_words(text),
  public.revise_rm(uuid, jsonb, text, uuid, text, integer),
  public.attach_rm_image(uuid, text, text, bigint, integer, integer),
  public.detach_rm_image(uuid),
  public.set_initiative_cover(uuid, text, text, bigint),
  public.clear_initiative_cover(uuid),
  public.set_initiative_cover_color(uuid, text)
  from public, anon;

grant execute on function
  public.count_words(text),
  public.revise_rm(uuid, jsonb, text, uuid, text, integer),
  public.attach_rm_image(uuid, text, text, bigint, integer, integer),
  public.detach_rm_image(uuid),
  public.set_initiative_cover(uuid, text, text, bigint),
  public.clear_initiative_cover(uuid),
  public.set_initiative_cover_color(uuid, text)
  to authenticated;
