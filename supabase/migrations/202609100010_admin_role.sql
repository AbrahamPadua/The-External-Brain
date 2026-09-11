-- An admin is a single, explicit grant that satisfies every application role
-- check. Keeping it as a grant means revocation is one action.
alter table public.role_grants drop constraint if exists role_grants_role_check;
alter table public.role_grants add constraint role_grants_role_check
  check (role in ('operations', 'research', 'admin'));

create or replace function public.has_role(role_name text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_approved(uid) and exists(
    select 1 from role_grants
    where user_id=uid and revoked_at is null and (role=role_name or role='admin')
  )
$$;

-- Preserve the existing transfer safeguards while including Admin in the
-- Research notification audience for released reviews.
create or replace function public.transfer_lead(p_initiative uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare old_lead uuid; ob record; released int:=0; begin
 if not public.is_approved() then raise exception 'approval required'; end if;
 select lead_id into old_lead from initiatives where id=p_initiative for update;
 if old_lead is null or not(old_lead=auth.uid() or public.has_role('research')) then raise exception 'lead or research required'; end if;
 if not public.is_approved(p_user) or not public.is_member(p_initiative,p_user) then raise exception 'new lead must be an approved participant'; end if;
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
