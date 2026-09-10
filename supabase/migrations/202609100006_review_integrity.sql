-- Review integrity. Supersedes three command bodies from 202609090003/202609090004
-- with create or replace (identical signatures, so ownership and existing grants are
-- kept and no permission is widened). Earlier migration files are unchanged.
--
-- 1. Conflict of interest is re-checked when a review is submitted, not only when it
--    is assigned, because membership can change in between.
-- 2. A leadership handover moves unfinished work to the new lead, but releases any
--    review the new lead may not judge back to Research instead of silently allowing
--    self-review. Submitted obligations keep their original responsible user, author
--    and versions as history, while the RM itself follows the role: the current lead
--    alone submits or revises it, and never re-earns HP for it.
-- 3. A lapse that follows a reversed penalty is chargeable again, while evaluator
--    retries still never charge the same lapse twice.

-- The penalty is no longer unique per obligation for all time. An obligation whose
-- penalty was reversed (reassignment, waiver, break week) can be missed again, so the
-- "at most one live penalty per obligation" invariant moves into
-- evaluate_due_obligations: a row lock over the candidates plus an explicit
-- live-penalty guard. Reward remains capped by hp_one_reward_per_obligation.
drop index if exists public.hp_one_penalty_per_obligation;

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

create or replace function public.transfer_lead(p_initiative uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare old_lead uuid; ob record; released int:=0; begin
 if not public.is_approved() then raise exception 'approval required'; end if;
 select lead_id into old_lead from initiatives where id=p_initiative for update;
 if old_lead is null or not(old_lead=auth.uid() or public.has_role('research')) then raise exception 'lead or research required'; end if;
 if not public.is_approved(p_user) or not public.is_member(p_initiative,p_user) then raise exception 'new lead must be an approved participant'; end if;
 -- Lock the unfinished obligations before conflicts are decided. A concurrent
 -- assign_review_target either committed first (and is seen below) or waits here and
 -- then re-reads this transfer's result, so no assignment slips past the check.
 perform 1 from obligations where initiative_id=p_initiative and status in ('open','missed') order by id for update;
 update initiatives set lead_id=p_user where id=p_initiative;
 update initiative_memberships set role=case when user_id=p_user then 'lead'::membership_role else 'member'::membership_role end where initiative_id=p_initiative and left_at is null;
 -- Unfinished work follows the role, including reviews this initiative owes others.
 -- Submitted obligations are left alone: their responsible user, document author and
 -- stored versions are history.
 update obligations set responsible_user_id=p_user where initiative_id=p_initiative and status in ('open','missed');
 -- A review the new lead cannot judge is returned to Research: the live penalty is
 -- reversed, the assignment is cleared and the obligation waits for a new target.
 for ob in select o.id from obligations o
   where o.initiative_id=p_initiative and o.kind='review' and o.status in ('open','missed') and o.target_document_id is not null
     and exists(select 1 from documents d where d.id=o.target_document_id and (d.initiative_id=o.initiative_id or public.is_member(d.initiative_id,p_user))) loop
  insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id)
   select e.initiative_id,'reversal',-e.points,e.obligation_id,e.id,'lead transfer released a conflicted review',auth.uid()
   from hp_events e where e.obligation_id=ob.id and e.kind='penalty' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id) on conflict do nothing;
  update obligations set target_document_id=null,target_version=null,assigned_by=null,assigned_at=null,status='open' where id=ob.id;
  insert into notifications(user_id,kind,payload)
   select rg.user_id,'review_unassigned',jsonb_build_object('obligation_id',ob.id,'initiative_id',p_initiative)
   from role_grants rg join profiles pr on pr.id=rg.user_id where rg.role='research' and rg.revoked_at is null and pr.account_status='approved';
  released:=released+1;
 end loop;
 perform public.audit('lead_transferred','initiative',p_initiative,jsonb_build_object('from',old_lead,'to',p_user,'reviews_released',released)); end $$;

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
    and exists(select 1 from initiatives i where i.id=o.initiative_id and i.status='active')
    and exists(select 1 from cycles c where c.id=o.cycle_id and not c.is_break)
  order by o.id for update) d;
 -- Charge only where no live (unreversed) penalty already stands for the obligation.
 with changed as (update obligations o set status='missed' where o.id=any(due_ids) and o.status='open' returning o.*)
 insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id,policy_version)
 select c.initiative_id,'penalty',-p.penalty,c.id,'missed obligation',auth.uid(),p.version::text from changed c
 where not exists(select 1 from hp_events e where e.obligation_id=c.id and e.kind='penalty' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id));
 get diagnostics n=row_count; return n; end $$;
