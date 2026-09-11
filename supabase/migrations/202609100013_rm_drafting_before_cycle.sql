-- 202609100013 Roast Me drafting is independent of cycle opening.
--
-- "RM" is a Roast Me: constructive criticism of a team's work. It is never a
-- reporting memo.
--
-- The failure this fixes: a Roast Me draft could only exist as a row hanging off
-- an obligation, and obligations only exist once Research opens a cycle. Worse,
-- open_cycle deliberately skips an initiative whose activated_at falls after the
-- week began, which is exactly the case for a freshly imported canonical
-- initiative - so its team could not draft even after a cycle was opened. Both
-- paths ended at "No open obligation".
--
-- The model here separates the two:
--   * a draft is a document owned by the initiative team, carrying the Monday of
--     the week it is meant for (documents.target_monday). It needs no cycle.
--   * a cycle obligation is attached at SUBMISSION, by submit_rm_draft, which
--     then delegates to the untouched submit_obligation so every deadline, HP,
--     lead-only and idempotency rule from 202609090003/006 still applies.
--
-- Nothing here widens who may act. Drafting and retargeting require
-- is_member(initiative); submitting still requires the current lead through
-- submit_obligation. Historical imports stay immutable and stay out of the
-- editable set. 202609100012 is applied and is not edited.

-- ---------------------------------------------------------------------------
-- 1. A draft that predates its cycle
-- ---------------------------------------------------------------------------

alter table public.documents add column if not exists target_monday date;

-- Existing live Roast Mes already point at exactly one cycle through their
-- obligation. Give them the same week key as new drafts before enforcing the
-- one-document-per-team/week rule below.
update public.documents d
set target_monday = c.starts_on
from public.obligations o
join public.cycles c on c.id = o.cycle_id
where d.obligation_id = o.id
  and d.kind = 'rm'
  and not d.is_historical_import
  and d.target_monday is null;

alter table public.documents drop constraint if exists documents_target_monday_is_monday;
alter table public.documents add constraint documents_target_monday_is_monday
  check (target_monday is null or extract(isodow from target_monday) = 1) not valid;
alter table public.documents validate constraint documents_target_monday_is_monday;

-- A live document may now stand without an obligation, but only while it is an
-- unsubmitted Roast Me draft that names the week it is for. Submitting attaches
-- the obligation, and every submitted row still has one.
alter table public.documents drop constraint if exists documents_historical_import_shape;
alter table public.documents add constraint documents_historical_import_shape check (
  (
    is_historical_import
    and obligation_id is null
    and author_id is null
    and historical_source_key is not null
    and btrim(historical_source_key) <> ''
  )
  or (
    not is_historical_import
    and author_id is not null
    and historical_source_key is null
    and (
      obligation_id is not null
      or (kind = 'rm' and submitted_version_number is null and target_monday is not null)
    )
  )
) not valid;
alter table public.documents validate constraint documents_historical_import_shape;

-- One Roast Me document per team per week, including after submission. Without
-- the submitted rows in this index a teammate could spend time on a second
-- draft that can never claim the already-used obligation.
create unique index if not exists documents_pending_rm_draft_unique
  on public.documents (initiative_id, target_monday)
  where kind = 'rm' and target_monday is not null and not is_historical_import;

-- ---------------------------------------------------------------------------
-- 2. Edit rights no longer depend on an obligation existing
-- ---------------------------------------------------------------------------

-- 202609090003 inner-joined obligations, so a document with a null obligation_id
-- was editable by nobody - the team could not even read back its own draft
-- through docs_access / drafts_team_access. A LEFT JOIN fixes that, and the
-- explicit historical exclusion keeps imported records exactly where
-- 202609100011/012 put them: not editable, Research-only for image attachment.
create or replace function public.can_edit_document(did uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_approved() and exists (
    select 1 from documents d
    left join obligations o on o.id = d.obligation_id
    where d.id = did
      and not d.is_historical_import
      and (
        (d.kind = 'rm' and public.is_member(d.initiative_id))
        or (d.kind = 'review' and o.responsible_user_id = auth.uid())
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. The Los Angeles working week
-- ---------------------------------------------------------------------------

-- date_trunc('week') is ISO, so it always lands on Monday. Everything that
-- defaults a week - drafting here, the cycle form in the client - uses the LA
-- wall clock, matching the Friday/Sunday deadlines open_cycle writes.
create or replace function public.current_la_monday()
returns date language sql stable set search_path = '' as $$
  select (date_trunc('week', (now() at time zone 'America/Los_Angeles')))::date
$$;

-- ---------------------------------------------------------------------------
-- 4. Draft, retarget, submit
-- ---------------------------------------------------------------------------

create function public.save_rm_draft(
  p_initiative uuid,
  p_content jsonb,
  p_target_monday date default null,
  p_document uuid default null,
  p_revision integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; target date; rev integer; did uuid; begin
  if not public.is_approved() then raise exception 'approved account required'; end if;

  if p_document is not null then
    select * into d from documents where id = p_document for update;
    if not found then raise exception 'unknown document'; end if;
    if d.is_historical_import then raise exception 'an imported Roast Me cannot be edited'; end if;
    if d.kind <> 'rm' then raise exception 'only a Roast Me draft is saved here'; end if;
    if d.submitted_version_number is not null then
      raise exception 'this Roast Me is submitted; revise it instead';
    end if;
    if not public.is_member(d.initiative_id) then raise exception 'initiative team required'; end if;
    if p_initiative is distinct from d.initiative_id then raise exception 'initiative does not match document'; end if;
    target := coalesce(p_target_monday, d.target_monday, public.current_la_monday());
    if extract(isodow from target) <> 1 then
      raise exception 'a Roast Me week must start on a Monday';
    end if;
    -- The week can still move while the draft is unattached to a cycle.
    if d.obligation_id is null and d.target_monday is distinct from target then
      update documents set target_monday = target where id = d.id;
    elsif d.obligation_id is not null and d.target_monday is distinct from target then
      raise exception 'this draft is already attached to an open cycle';
    end if;
    did := d.id;
  else
    target := coalesce(p_target_monday, public.current_la_monday());
    if extract(isodow from target) <> 1 then
      raise exception 'a Roast Me week must start on a Monday';
    end if;
    if not public.is_member(p_initiative) then raise exception 'initiative team required'; end if;
    if not exists (select 1 from initiatives where id = p_initiative and status = 'active') then
      raise exception 'initiative is not active';
    end if;
    -- Reuse the team's draft for this week instead of starting a second one.
    insert into documents(kind, initiative_id, author_id, target_monday)
      values ('rm', p_initiative, auth.uid(), target)
      on conflict (initiative_id, target_monday)
        where kind = 'rm' and target_monday is not null and not is_historical_import
        do nothing
      returning id into did;
    if did is null then
      select * into d from documents
        where initiative_id = p_initiative and kind = 'rm' and not is_historical_import
          and target_monday = target
        for update;
      if found and (d.obligation_id is not null or d.submitted_version_number is not null) then
        raise exception 'a Roast Me already exists for this initiative and week';
      end if;
      did := d.id;
      -- createDraft doubles as "open the existing draft". With no revision
      -- token it must not overwrite that draft's content or report a conflict.
      if did is not null and p_revision is null then return did; end if;
    end if;
    if did is null then raise exception 'could not open a Roast Me draft'; end if;
  end if;

  select revision into rev from document_drafts where document_id = did;
  if rev is not null and p_revision is distinct from rev then
    raise exception 'draft conflict: reload before saving';
  end if;
  insert into document_drafts(document_id, content, updated_by)
    values (did, p_content, auth.uid())
    on conflict (document_id) do update
      set content = excluded.content, revision = document_drafts.revision + 1,
          updated_by = auth.uid(), updated_at = now();
  return did;
end $$;

create function public.set_rm_draft_target(p_document uuid, p_target_monday date)
returns void language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  if p_target_monday is null or extract(isodow from p_target_monday) <> 1 then
    raise exception 'a Roast Me week must start on a Monday';
  end if;
  select * into d from documents where id = p_document for update;
  if not found then raise exception 'unknown document'; end if;
  if d.is_historical_import then raise exception 'an imported Roast Me cannot be retargeted'; end if;
  if d.kind <> 'rm' then raise exception 'only a Roast Me draft has a target week'; end if;
  if not public.is_member(d.initiative_id) then raise exception 'initiative team required'; end if;
  if d.submitted_version_number is not null then
    raise exception 'a submitted Roast Me keeps the week it was submitted for';
  end if;
  if d.obligation_id is not null then
    raise exception 'this draft is already attached to an open cycle';
  end if;
  if exists (
    select 1 from documents x
    where x.id <> d.id and x.initiative_id = d.initiative_id
      and x.kind = 'rm' and not x.is_historical_import
      and x.target_monday = p_target_monday
  ) then
    raise exception 'a Roast Me already exists for this initiative and week';
  end if;
  update documents set target_monday = p_target_monday where id = d.id;
  perform public.audit('rm_draft_retargeted', 'document', d.id,
    jsonb_build_object('target_monday', p_target_monday));
end $$;

create function public.submit_rm_draft(p_document uuid, p_content jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; c cycles%rowtype; o obligations%rowtype; cur_lead uuid; opened boolean := false; begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  select * into d from documents where id = p_document for update;
  if not found then raise exception 'unknown document'; end if;
  if d.is_historical_import or d.kind <> 'rm' then
    raise exception 'only a Roast Me draft is submitted here';
  end if;
  if not public.is_member(d.initiative_id) then raise exception 'initiative team required'; end if;

  -- Drafted after the cycle opened: nothing to attach, the existing path applies
  -- unchanged (including its lead-only, deadline and HP rules).
  if d.obligation_id is not null then
    select * into o from obligations where id = d.obligation_id for update;
    if not found or o.kind <> 'rm' or o.initiative_id <> d.initiative_id then
      raise exception 'the attached Roast Me obligation does not match this document';
    end if;
    if d.target_monday is not null and not exists (
      select 1 from cycles x where x.id = o.cycle_id and x.starts_on = d.target_monday
    ) then
      raise exception 'the attached Roast Me obligation does not match the target week';
    end if;
    return public.submit_obligation(d.obligation_id, p_content, null::uuid, null::integer);
  end if;
  if d.submitted_version_number is not null then
    raise exception 'this Roast Me is already submitted';
  end if;
  if d.target_monday is null then raise exception 'choose the week this Roast Me is for'; end if;

  select * into c from cycles where starts_on = d.target_monday;
  if not found then
    raise exception 'the cycle for the week of % is not open yet; Research opens it', d.target_monday;
  end if;
  if c.is_break then
    raise exception 'the week of % is a break week, so it takes no Roast Me', d.target_monday;
  end if;

  select * into o from obligations
    where cycle_id = c.id and initiative_id = d.initiative_id and kind = 'rm' for update;
  if not found then
    -- open_cycle skips an initiative that activated after the week began, which
    -- is what happens to a canonical import. Open the one missing obligation for
    -- THIS initiative, and only while its deadline is still ahead, so no past
    -- cycle can be back-filled for HP. The unique(cycle_id,initiative_id,kind)
    -- constraint makes a concurrent opener a no-op rather than a duplicate.
    if c.rm_due_at <= now() then
      raise exception 'the Roast Me deadline for the week of % has passed and no obligation was opened; ask Research', d.target_monday;
    end if;
    select lead_id into cur_lead from initiatives
      where id = d.initiative_id and status = 'active';
    if cur_lead is null then raise exception 'initiative is not active'; end if;
    insert into obligations(cycle_id, initiative_id, kind, responsible_user_id, due_at)
      values (c.id, d.initiative_id, 'rm', cur_lead, c.rm_due_at)
      on conflict (cycle_id, initiative_id, kind) do nothing
      returning * into o;
    opened := found;
    if not opened then
      select * into o from obligations
        where cycle_id = c.id and initiative_id = d.initiative_id and kind = 'rm' for update;
    end if;
    if not found then raise exception 'could not open a Roast Me obligation for this week'; end if;
    if opened then
      perform public.audit('rm_obligation_opened', 'obligation', o.id,
        jsonb_build_object('initiative', d.initiative_id, 'cycle', c.id));
    end if;
  end if;

  if exists (select 1 from documents x where x.obligation_id = o.id and x.id <> d.id) then
    raise exception 'another Roast Me is already attached to this week for this initiative';
  end if;
  update documents set obligation_id = o.id where id = d.id;
  return public.submit_obligation(o.id, p_content, null::uuid, null::integer);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants (202609090003 revoked EXECUTE from every role)
-- ---------------------------------------------------------------------------

revoke all on function
  public.current_la_monday(),
  public.save_rm_draft(uuid, jsonb, date, uuid, integer),
  public.set_rm_draft_target(uuid, date),
  public.submit_rm_draft(uuid, jsonb)
  from public, anon;

grant execute on function
  public.current_la_monday(),
  public.save_rm_draft(uuid, jsonb, date, uuid, integer),
  public.set_rm_draft_target(uuid, date),
  public.submit_rm_draft(uuid, jsonb)
  to authenticated;
