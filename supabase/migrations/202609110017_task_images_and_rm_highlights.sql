-- 202609110017 Task description images, and version-anchored Roast Me highlights.
--
-- Two additions. Migrations 001-016 are not edited; everything here is new or a
-- same-signature create-or-replace.
--
-- 1. Task descriptions can carry inline images, stored the same way Roast Me
--    images already are (202609100012): the durable reference is the storage
--    object path, held in data-object-path inside the description, and the bytes
--    live in the private initiative-images bucket. A new task_attachments table
--    links object to task so the read policy can authorise it, and the bucket's
--    read policy gains a task branch without loosening the Roast Me branches.
--
-- 2. A comment thread on a submitted Roast Me version can record the character
--    range of the passage it is about, so the highlight can be drawn over that
--    version's text instead of only quoted beside it. comment_threads already
--    carries document_id + version_number (001), which is what makes the anchor
--    version-specific: a later revision keeps its own versions untouched, and an
--    anchor never migrates across versions.

-- ---------------------------------------------------------------------------
-- 1. Task description images
-- ---------------------------------------------------------------------------

-- Rich descriptions hold markup plus image references, so the 202609110014 cap
-- of 2000 characters is raised. The bound still exists, it is just sized for
-- markup rather than a sentence.
alter table public.tasks drop constraint if exists tasks_details_length;
alter table public.tasks add constraint tasks_details_length
  check (char_length(details) <= 8000) not valid;
alter table public.tasks validate constraint tasks_details_length;

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  bucket_id text not null default 'initiative-images',
  object_path text not null unique,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint task_attachments_mime_ok
    check (mime_type in ('image/png','image/jpeg','image/gif','image/webp')),
  constraint task_attachments_size_ok
    check (byte_size > 0 and byte_size <= 10485760),
  constraint task_attachments_dims_ok
    check ((width is null or width > 0) and (height is null or height > 0))
);
alter table public.task_attachments enable row level security;
-- Tasks themselves are readable by any approved account (tasks_access, 202609090001),
-- so their images follow exactly that audience and no wider.
create policy task_attachments_read on public.task_attachments for select
  using (exists (select 1 from public.tasks t
    where t.id = task_id and public.can_access_initiative(t.initiative_id)));
revoke insert, update, delete on public.task_attachments from anon, authenticated;
grant select on public.task_attachments to authenticated;

-- Who may change a task's description, which is who may attach to it: the same
-- lead/admin authority update_task requires. An assignee keeps status-only rights.
create or replace function public.can_edit_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from tasks t
    where t.id = p_task
      and (public.is_admin() or exists (
        select 1 from initiatives i where i.id = t.initiative_id and i.lead_id = auth.uid()
      ))
  )
$$;

-- SECURITY DEFINER so task_attachments RLS cannot make a linked object look
-- unlinked and fall through to the broader folder policy.
create or replace function public.has_task_image_attachment(p_object_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from task_attachments a where a.object_path = p_object_path)
$$;

create or replace function public.can_read_task_image_attachment(p_object_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from task_attachments a
    join tasks t on t.id = a.task_id
    where a.object_path = p_object_path
      and public.can_access_initiative(t.initiative_id)
  )
$$;

create function public.attach_task_image(
  p_task uuid, p_object_path text, p_mime text, p_bytes bigint,
  p_width integer default null, p_height integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype; a uuid; existing task_attachments%rowtype; begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  select * into t from tasks where id = p_task;
  if not found then raise exception 'unknown task'; end if;
  if not public.can_edit_task(p_task) then raise exception 'lead or admin required'; end if;
  if p_mime not in ('image/png','image/jpeg','image/gif','image/webp') then
    raise exception 'unsupported image type %', p_mime;
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760 then
    raise exception 'image must be between 1 byte and 10 MiB';
  end if;
  if coalesce((storage.foldername(p_object_path))[1], '') <> t.initiative_id::text then
    raise exception 'object path must sit under the initiative folder';
  end if;
  -- One path names one object: never let it be rebound to another task, which
  -- would move it to a different read audience.
  select * into existing from task_attachments where object_path = p_object_path for update;
  if found and existing.task_id <> t.id then
    raise exception 'object is already attached to another task';
  end if;
  if exists (select 1 from document_attachments where object_path = p_object_path) then
    raise exception 'object is already attached to a Roast Me';
  end if;
  insert into task_attachments(task_id, object_path, mime_type, byte_size, width, height, created_by)
    values (t.id, p_object_path, p_mime, p_bytes, p_width, p_height, auth.uid())
    on conflict (object_path) do update
      set mime_type = excluded.mime_type, byte_size = excluded.byte_size,
          width = excluded.width, height = excluded.height
      where public.task_attachments.task_id = t.id
    returning id into a;
  if a is null then raise exception 'object is already attached to another task'; end if;
  perform public.audit('task_image_attached', 'task', t.id,
    jsonb_build_object('attachment', a, 'bytes', p_bytes, 'mime', p_mime));
  return a;
end $$;

create function public.detach_task_image(p_attachment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r task_attachments%rowtype; begin
  select * into r from task_attachments where id = p_attachment;
  if not found then return; end if;
  if not (public.can_edit_task(r.task_id) or r.created_by = auth.uid()) then
    raise exception 'lead or admin required';
  end if;
  -- Detaching removes the bytes, so refuse while the description still shows
  -- them. The reference has to leave the text first.
  if exists (select 1 from tasks t
    where t.id = r.task_id and position(r.object_path in coalesce(t.details, '')) > 0) then
    raise exception 'the task description still shows this image; remove it there first';
  end if;
  delete from storage.objects where bucket_id = r.bucket_id and name = r.object_path;
  delete from task_attachments where id = p_attachment;
  perform public.audit('task_image_detached', 'task', r.task_id,
    jsonb_build_object('attachment', p_attachment));
end $$;

-- Same signatures as 202609110014 / 202609110015, so grants and ownership carry
-- over. The only change is the description bound.
create or replace function public.create_task(
  p_initiative uuid, p_title text, p_details text default '', p_assignee uuid default null,
  p_due_at timestamptz default null, p_status text default 'planned'
) returns uuid language plpgsql security definer set search_path=public as $$
declare tid uuid; begin
  if not public.is_approved() or not (public.is_admin() or exists (
    select 1 from initiatives where id=p_initiative and lead_id=auth.uid()
  )) then raise exception 'lead or admin required'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 160 then raise exception 'title must be 1 to 160 characters'; end if;
  if char_length(coalesce(p_details,'')) > 8000 then raise exception 'description must be at most 8000 characters'; end if;
  if p_status not in ('planned','pending','finished') then raise exception 'invalid task status'; end if;
  if p_assignee is not null and not exists (
    select 1 from initiative_memberships m join profiles p on p.id=m.user_id
    where m.initiative_id=p_initiative and m.user_id=p_assignee and m.left_at is null
      and p.account_status='approved'
  ) then raise exception 'assignee must be an approved initiative member'; end if;
  insert into tasks(initiative_id,title,details,status,assignee_id,due_at,created_by)
    values(p_initiative,btrim(p_title),coalesce(p_details,''),p_status,p_assignee,p_due_at,auth.uid())
    returning id into tid;
  perform public.audit('task_created','task',tid,jsonb_build_object('initiative',p_initiative,'status',p_status));
  return tid;
end $$;

create or replace function public.update_task(
 p_task uuid, p_title text, p_details text default '', p_assignee uuid default null,
 p_due_at timestamptz default null, p_status text default 'planned'
) returns void language plpgsql security definer set search_path=public as $$
declare t tasks%rowtype; begin
 if not public.is_approved() then raise exception 'approval required'; end if;
 select * into t from tasks where id=p_task for update;
 if not found then raise exception 'unknown task'; end if;
 if not(public.is_admin() or exists(select 1 from initiatives where id=t.initiative_id and lead_id=auth.uid()))
  then raise exception 'lead or admin required'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 1 and 160 then raise exception 'title must be 1 to 160 characters'; end if;
 if char_length(coalesce(p_details,''))>8000 then raise exception 'description must be at most 8000 characters'; end if;
 if p_status not in ('planned','pending','finished') then raise exception 'invalid task status'; end if;
 if p_assignee is not null and not exists(
  select 1 from initiative_memberships m join profiles p on p.id=m.user_id
  where m.initiative_id=t.initiative_id and m.user_id=p_assignee and m.left_at is null
   and p.account_status='approved') then raise exception 'assignee must be an approved initiative member'; end if;
 update tasks set title=btrim(p_title),details=coalesce(p_details,''),assignee_id=p_assignee,
  due_at=p_due_at,status=p_status,updated_at=now() where id=p_task;
 perform public.audit('task_updated','task',p_task,jsonb_build_object('fields','details','status',p_status));
end $$;

-- Deleting a task cascades its attachment rows; take the bytes with them so the
-- bucket does not accumulate objects nothing can reach.
create or replace function public.delete_task(p_task uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t tasks%rowtype; begin
  if not public.is_approved() then raise exception 'approval required'; end if;
  select * into t from tasks where id=p_task for update;
  if not found then raise exception 'unknown task'; end if;
  if not (public.is_admin() or exists (
    select 1 from initiatives where id=t.initiative_id and lead_id=auth.uid()
  )) then raise exception 'lead or admin required'; end if;
  delete from storage.objects o using task_attachments a
    where a.task_id = p_task and o.bucket_id = a.bucket_id and o.name = a.object_path;
  delete from tasks where id=p_task;
  perform public.audit('task_deleted','task',p_task,
    jsonb_build_object('initiative',t.initiative_id,'title',t.title));
end $$;

-- Read: the Roast Me branches from 202609100012 are unchanged; a task branch is
-- added, and a task-linked object is no longer treated as unlinked. Insert and
-- delete already admit a folder-initiative member and the lead/admin, which is
-- who edits a task, so they are left exactly as 012 wrote them.
drop policy if exists initiative_images_read on storage.objects;
create policy initiative_images_read on storage.objects for select using (
  bucket_id = 'initiative-images'
  and public.is_approved()
  and (
    public.can_read_rm_image_attachment(name)
    or public.can_read_task_image_attachment(name)
    or (
      not public.has_rm_image_attachment(name)
      and not public.has_task_image_attachment(name)
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

-- ---------------------------------------------------------------------------
-- 2. Version-anchored Roast Me highlights
-- ---------------------------------------------------------------------------

-- Character offsets into the plain text of the anchored version. Null means an
-- older, quote-only thread, which still renders beside the document.
alter table public.comment_threads add column if not exists anchor_start integer;
alter table public.comment_threads add column if not exists anchor_end integer;

alter table public.comment_threads drop constraint if exists comment_threads_anchor_range;
alter table public.comment_threads add constraint comment_threads_anchor_range check (
  (anchor_start is null and anchor_end is null)
  or (anchor_start >= 0 and anchor_end > anchor_start and anchor_end - anchor_start <= 2000)
) not valid;
alter table public.comment_threads validate constraint comment_threads_anchor_range;

/*
 * Start a thread anchored to a selected passage of one submitted version.
 *
 * The (document_id, version_number) foreign key from 202609090001 already
 * guarantees the version exists; can_read_document keeps the audience to
 * approved accounts that may read the document. The offsets are recorded as
 * given and verified against the quote length, so a client cannot claim a range
 * that does not match the text it says it selected. Nothing here can edit a
 * stored version: highlights live beside the content, never inside it.
 */
create function public.add_anchored_comment(
  p_document uuid,
  p_version integer,
  p_quote text,
  p_anchor_start integer,
  p_anchor_end integer,
  p_body text
) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; quote_len integer; begin
  if not public.can_read_document(p_document) then
    raise exception 'document access required';
  end if;
  if not exists (select 1 from document_versions
    where document_id = p_document and version_number = p_version) then
    raise exception 'submitted version required';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 or char_length(p_body) > 20000 then
    raise exception 'comment must contain 1 to 20000 characters';
  end if;
  quote_len := char_length(coalesce(p_quote, ''));
  if quote_len = 0 then raise exception 'select the passage this comment is about'; end if;
  if p_anchor_start is null or p_anchor_end is null
    or p_anchor_start < 0 or p_anchor_end <= p_anchor_start then
    raise exception 'an anchored comment needs a valid character range';
  end if;
  if p_anchor_end - p_anchor_start <> quote_len then
    raise exception 'the character range does not match the selected passage';
  end if;
  insert into comment_threads(document_id, version_number, block_id, quote, created_by,
      anchor_start, anchor_end)
    values (p_document, p_version, 'selection', left(p_quote, 2000), auth.uid(),
      p_anchor_start, p_anchor_end)
    returning id into tid;
  insert into comments(thread_id, body, author_id) values (tid, p_body, auth.uid())
    returning id into cid;
  perform public.audit('comment_anchored', 'comment_thread', tid,
    jsonb_build_object('document', p_document, 'version', p_version,
      'start', p_anchor_start, 'end', p_anchor_end));
  return tid;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Grants (202609090003 revoked EXECUTE from every role)
-- ---------------------------------------------------------------------------

revoke all on function
  public.can_edit_task(uuid),
  public.has_task_image_attachment(text),
  public.can_read_task_image_attachment(text),
  public.attach_task_image(uuid, text, text, bigint, integer, integer),
  public.detach_task_image(uuid),
  public.add_anchored_comment(uuid, integer, text, integer, integer, text)
  from public, anon;

grant execute on function
  public.can_edit_task(uuid),
  public.has_task_image_attachment(text),
  public.can_read_task_image_attachment(text),
  public.attach_task_image(uuid, text, text, bigint, integer, integer),
  public.detach_task_image(uuid),
  public.add_anchored_comment(uuid, integer, text, integer, integer, text)
  to authenticated;
