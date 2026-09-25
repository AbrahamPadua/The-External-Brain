-- Text leads for imported initiatives; a real account can be assigned later.
-- Preserve the prior migrations and all existing lead assignments.
alter table public.initiatives alter column lead_id drop not null;
alter table public.initiatives add column lead_name text not null default '';
alter table public.initiatives add constraint initiatives_lead_name_valid
 check (lead_name = btrim(lead_name) and char_length(lead_name) <= 160);

-- Manual cycle opening skips initiatives without an account lead.
create or replace function public.open_cycle(p_monday date,p_break boolean default false) returns uuid language plpgsql security definer set search_path=public as $$ declare cid uuid; begin
 if not public.has_role('research') and coalesce(auth.role(),'')<>'service_role' then raise exception 'research required'; end if;
 if extract(isodow from p_monday)<>1 then raise exception 'cycle must start Monday'; end if;
 insert into cycles(starts_on,rm_due_at,review_due_at,is_break,created_by) values(p_monday,((p_monday+4)+time '23:59') at time zone 'America/Los_Angeles',((p_monday+6)+time '23:59') at time zone 'America/Los_Angeles',p_break,auth.uid()) on conflict(starts_on) do nothing;
 select id into cid from cycles where starts_on=p_monday;
 if not (select is_break from cycles where id=cid) then
 insert into obligations(cycle_id,initiative_id,kind,responsible_user_id,due_at) select cid,i.id,k.kind::obligation_kind,i.lead_id,case when k.kind='rm' then c.rm_due_at else c.review_due_at end from initiatives i cross join (values('rm'),('review')) k(kind) join cycles c on c.id=cid where i.status='active' and i.lead_id is not null and i.activated_at<(p_monday::timestamp at time zone 'America/Los_Angeles') on conflict do nothing;
 end if; return cid; end $$;

-- The scheduled cycle and penalty processor uses the same rule.
create or replace function public.run_weekly_processing(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public as $$
declare monday date:=date_trunc('week',p_now at time zone 'America/Los_Angeles')::date;
 c cycles%rowtype; policy system_policy%rowtype; due_ids uuid[];
 made_cycle int:=0; made_obligations int:=0; made_penalties int:=0;
begin
 if session_user<>'postgres' then raise exception 'database owner required'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('open-labs-weekly-processing',0)) then
  return jsonb_build_object('status','already_running','la_monday',monday); end if;
 insert into cycles(starts_on,rm_due_at,review_due_at,is_break,created_by)
  values(monday,((monday+4)+time '23:59') at time zone 'America/Los_Angeles',
   ((monday+6)+time '23:59') at time zone 'America/Los_Angeles',false,null)
  on conflict(starts_on) do nothing;
 get diagnostics made_cycle=row_count;
 select * into c from cycles where starts_on=monday for update;
 -- A manual cycle/break wins. A working week receives only missing obligations.
 if not c.is_break then
  insert into obligations(cycle_id,initiative_id,kind,responsible_user_id,due_at)
   select c.id,i.id,k.kind::obligation_kind,i.lead_id,
    case when k.kind='rm' then c.rm_due_at else c.review_due_at end
   from initiatives i cross join (values('rm'),('review')) k(kind)
   where i.status='active' and i.lead_id is not null and i.activated_at<(monday::timestamp at time zone 'America/Los_Angeles')
   on conflict(cycle_id,initiative_id,kind) do nothing;
  get diagnostics made_obligations=row_count;
 end if;
 select * into policy from system_policy;
 select coalesce(array_agg(x.id),'{}'::uuid[]) into due_ids from (
  select o.id from obligations o where o.status='open' and o.due_at<p_now
   and (o.kind='rm' or o.target_document_id is not null)
   and exists(select 1 from initiatives i where i.id=o.initiative_id and i.status='active' and i.lead_id is not null)
   and exists(select 1 from cycles cx where cx.id=o.cycle_id and not cx.is_break)
  order by o.id for update) x;
 with changed as(update obligations o set status='missed'
  where o.id=any(due_ids) and o.status='open' returning o.*)
 insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id,policy_version)
  select x.initiative_id,'penalty',-policy.penalty,x.id,'missed obligation',null,policy.version::text
  from changed x where not exists(select 1 from hp_events e where e.obligation_id=x.id
   and e.kind='penalty' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id));
 get diagnostics made_penalties=row_count;
 insert into weekly_processing_runs(la_monday,cycle_id,cycle_created,is_break,obligations_created,penalties_created)
  values(monday,c.id,made_cycle=1,c.is_break,made_obligations,made_penalties);
 return jsonb_build_object('status','ok','la_monday',monday,'cycle_id',c.id,
  'cycle_created',made_cycle=1,'is_break',c.is_break,'obligations_created',made_obligations,
  'penalties_created',made_penalties);
end $$;

-- The manual deadline evaluator must also skip unassigned initiatives.
create or replace function public.evaluate_due_obligations(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path=public as $$
declare n int; p system_policy%rowtype; due_ids uuid[]; begin
 if not public.has_role('research') and coalesce(auth.role(),'')<>'service_role' then raise exception 'research required'; end if;
 if p_now>now() then raise exception 'cannot evaluate future deadlines'; end if;
 select * into p from system_policy;
 -- Lock every candidate first, in id order. A second evaluator waits here and then
 -- re-checks status='open', so a lapse already recorded by the first run disappears
 -- from its candidate set instead of being charged twice.
 select coalesce(array_agg(d.id),'{}'::uuid[]) into due_ids from (
  select o.id from obligations o
  where o.status='open' and o.due_at<p_now and (o.kind='rm' or o.target_document_id is not null)
    and exists(select 1 from initiatives i where i.id=o.initiative_id and i.status='active' and i.lead_id is not null)
    and exists(select 1 from cycles c where c.id=o.cycle_id and not c.is_break)
  order by o.id for update) d;
 -- Charge only where no live (unreversed) penalty already stands for the obligation.
 with changed as (update obligations o set status='missed' where o.id=any(due_ids) and o.status='open' returning o.*)
 insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id,policy_version)
 select c.initiative_id,'penalty',-p.penalty,c.id,'missed obligation',auth.uid(),p.version::text from changed c
 where not exists(select 1 from hp_events e where e.obligation_id=c.id and e.kind='penalty' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id));
 get diagnostics n=row_count; return n; end $$;

-- First assignment is Research/Admin-only; ordinary transfers keep their safeguards.
create or replace function public.transfer_lead(p_initiative uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare old_lead uuid; ob record; released int:=0; begin
 if not public.is_approved() then raise exception 'approval required'; end if;
 select lead_id into old_lead from initiatives where id=p_initiative for update;
 if not found then raise exception 'unknown initiative'; end if;
 if old_lead is null then
  if not public.has_role('research') then raise exception 'research required to assign the first lead'; end if;
  if p_user is null or not coalesce(public.is_approved(p_user),false) then raise exception 'new lead must be an approved account'; end if;
  update initiative_memberships set role='member' where initiative_id=p_initiative and left_at is null and role='lead';
  update initiative_memberships set role='lead' where initiative_id=p_initiative and user_id=p_user and left_at is null;
  if not found then
   insert into initiative_memberships(initiative_id,user_id,role) values(p_initiative,p_user,'lead');
  end if;
  update initiatives set lead_id=p_user,
   activated_at=case when status='active' then now() else activated_at end, updated_at=now()
   where id=p_initiative;
  perform public.audit('lead_assigned','initiative',p_initiative,jsonb_build_object('to',p_user));
  return;
 end if;
 if not(old_lead=auth.uid() or public.has_role('research')) then raise exception 'lead or research required'; end if;
 if p_user is null or not coalesce(public.is_approved(p_user),false) or not coalesce(public.is_member(p_initiative,p_user),false) then raise exception 'new lead must be an approved participant'; end if;
 perform 1 from obligations where initiative_id=p_initiative and status in ('open','missed') order by id for update;
 update initiatives set lead_id=p_user where id=p_initiative;
 update initiative_memberships set role=case when user_id=p_user then 'lead'::membership_role else 'member'::membership_role end where initiative_id=p_initiative and left_at is null;
 update obligations set responsible_user_id=p_user where initiative_id=p_initiative and status in ('open','missed');
 for ob in select o.id from obligations o
   where o.initiative_id=p_initiative and o.kind='review' and o.status in ('open','missed') and o.target_document_id is not null
     and exists(select 1 from documents d where d.id=o.target_document_id and (d.initiative_id=o.initiative_id or public.is_member(d.initiative_id,p_user))) loop
  insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id)
   select e.initiative_id,'reversal',-e.points,e.obligation_id,e.id,'lead transfer released a conflicted review',auth.uid()
   from hp_events e where e.obligation_id=ob.id and e.kind='penalty' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id) on conflict do nothing;
  update obligations set target_document_id=null,target_version=null,assigned_by=null,assigned_at=null,status='open' where id=ob.id;
  insert into notifications(user_id,kind,payload)
   select rg.user_id,'review_unassigned',jsonb_build_object('obligation_id',ob.id,'initiative_id',p_initiative)
   from role_grants rg join profiles pr on pr.id=rg.user_id where rg.role in ('research','admin') and rg.revoked_at is null and pr.account_status='approved';
  released:=released+1;
 end loop;
 perform public.audit('lead_transferred','initiative',p_initiative,jsonb_build_object('from',old_lead,'to',p_user,'reviews_released',released)); end $$;

-- An unassigned team receives a clear submission error.
create or replace function public.submit_rm_draft(p_document uuid, p_content jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; c cycles%rowtype; o obligations%rowtype; cur_lead uuid; opened boolean := false; begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  select * into d from documents where id = p_document for update;
  if not found then raise exception 'unknown document'; end if;
  if d.is_historical_import or d.kind <> 'rm' then
    raise exception 'only a Roast Me draft is submitted here';
  end if;
  if not public.is_member(d.initiative_id) then raise exception 'initiative team required'; end if;
  select lead_id into cur_lead from initiatives where id=d.initiative_id;
  if cur_lead is null then raise exception 'Assign a lead first'; end if;

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

create or replace function public.submit_obligation(p_obligation uuid,p_content jsonb,p_reviewed_document uuid default null,p_reviewed_version integer default null) returns uuid language plpgsql security definer set search_path=public as $$
declare o obligations%rowtype; did uuid; v int; p system_policy%rowtype; cur_lead uuid; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 select * into o from obligations where id=p_obligation for update; if not found or o.status not in ('open','missed','submitted') then raise exception 'not submittable'; end if;
 select lead_id into cur_lead from initiatives where id=o.initiative_id;
 -- The team memo belongs to the role, not to whoever once held it: only the initiative's
 -- current lead (approved, checked above) submits or revises an RM, so a handover neither
 -- strands a submitted memo nor leaves it with a departed lead. The original assignee
 -- survives in obligations.responsible_user_id, documents.author_id and every version.
 -- A review stays with its currently assigned reviewer; leadership is no override there.
 if o.kind='rm' and cur_lead is null then raise exception 'Assign a lead first'; end if;
 if o.kind='rm' and cur_lead is distinct from auth.uid() then raise exception 'current initiative lead required'; end if;
 if o.kind='review' then
  if o.responsible_user_id<>auth.uid() then raise exception 'assigned reviewer required'; end if;
  if o.target_document_id is null or p_reviewed_document is distinct from o.target_document_id or p_reviewed_version is distinct from o.target_version then raise exception 'review must reference assigned RM version'; end if;
  -- Assignment-time checks can be outlived by a lead transfer or an approved join
  -- request, so the conflict is re-established against current membership here.
  if exists(select 1 from documents d where d.id=o.target_document_id and (d.initiative_id=o.initiative_id or public.is_member(d.initiative_id,auth.uid()))) then raise exception 'reviewer cannot belong to the reviewed initiative'; end if;
 end if;
 select id into did from documents where obligation_id=o.id;
 if did is null then insert into documents(obligation_id,kind,initiative_id,author_id,reviewed_document_id,reviewed_version_number) values(o.id,o.kind::text::document_kind,o.initiative_id,auth.uid(),o.target_document_id,o.target_version) returning id into did; end if;
 if o.status='submitted' and exists(select 1 from document_versions where document_id=did and version_number=(select submitted_version_number from documents where id=did) and content=p_content) then return did; end if;
 select coalesce(max(version_number),0)+1 into v from document_versions where document_id=did;
 insert into document_versions(document_id,version_number,content,submitted_at,created_by) values(did,v,p_content,now(),auth.uid());
 update documents set submitted_version_number=v,reviewed_document_id=o.target_document_id,reviewed_version_number=o.target_version where id=did;
 update obligations set status='submitted',submitted_at=coalesce(submitted_at,now()) where id=o.id;
 delete from document_drafts where document_id=did;
 select * into p from system_policy;
 -- Only a live penalty is reversed; an obligation may now carry an older reversed one.
 insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id)
  select e.initiative_id,'reversal',-e.points,e.obligation_id,e.id,'late completion reverses penalty',auth.uid()
  from hp_events e where e.obligation_id=o.id and e.kind='penalty' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id) on conflict do nothing;
 insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id,policy_version) values(o.initiative_id,'reward',p.reward,o.id,'completed obligation',auth.uid(),p.version::text) on conflict do nothing;
 perform audit('document_submitted','document',did,jsonb_build_object('version',v,'responsible',o.responsible_user_id)); return did; end $$;
