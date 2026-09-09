create or replace function public.set_initiative_status(p_initiative uuid,p_status public.initiative_status,p_reason text) returns void language plpgsql security definer set search_path=public as $$ declare old_status initiative_status; begin
 if not public.has_role('research') or length(trim(p_reason))=0 then raise exception 'research and reason required'; end if;
 select status into old_status from initiatives where id=p_initiative for update; if not found then raise exception 'unknown initiative'; end if; if old_status=p_status then return; end if;
 update initiatives set status=p_status,activated_at=case when p_status='active' then now() else activated_at end,closed_at=case when p_status in ('completed','stopped','dead') then now() else null end,updated_at=now() where id=p_initiative;
 if p_status<>'active' then
 update obligations set status='waived',waived_at=now(),waived_by=auth.uid(),waiver_reason=p_reason where initiative_id=p_initiative and status in ('open','missed');
 insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id) select e.initiative_id,'reversal',-e.points,e.obligation_id,e.id,'waived: '||p_reason,auth.uid() from hp_events e join obligations o on o.id=e.obligation_id where o.initiative_id=p_initiative and o.status='waived' and e.kind='penalty' on conflict do nothing;
 end if;
 perform audit('initiative_status_changed','initiative',p_initiative,jsonb_build_object('from',old_status,'to',p_status,'reason',p_reason)); end $$;
create or replace function public.create_task(p_initiative uuid,p_title text,p_details text default '',p_assignee uuid default null,p_due_at timestamptz default null) returns uuid language plpgsql security definer set search_path=public as $$ declare tid uuid; begin
 if not public.is_approved() or not(public.is_admin() or exists(select 1 from initiatives where id=p_initiative and lead_id=auth.uid())) then raise exception 'lead or admin required'; end if;
 if length(trim(p_title))=0 then raise exception 'title required'; end if;
 insert into tasks(initiative_id,title,details,assignee_id,due_at,created_by) values(p_initiative,p_title,p_details,p_assignee,p_due_at,auth.uid()) returning id into tid; return tid; end $$;
create or replace function public.update_task_status(p_task uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.is_approved() or not exists(select 1 from tasks t join initiatives i on i.id=t.initiative_id where t.id=p_task and (i.lead_id=auth.uid() or t.assignee_id=auth.uid() or public.is_admin())) then raise exception 'task authority required'; end if;
 update tasks set status=p_status,updated_at=now() where id=p_task; end $$;
create function public.transfer_lead(p_initiative uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$ declare old_lead uuid; begin
 if not public.is_approved() then raise exception 'approval required'; end if;
 select lead_id into old_lead from initiatives where id=p_initiative for update;
 if old_lead is null or not(old_lead=auth.uid() or public.has_role('research')) then raise exception 'lead or research required'; end if;
 if not public.is_approved(p_user) or not public.is_member(p_initiative,p_user) then raise exception 'new lead must be an approved participant'; end if;
 update initiatives set lead_id=p_user where id=p_initiative;
 update initiative_memberships set role=case when user_id=p_user then 'lead'::membership_role else 'member'::membership_role end where initiative_id=p_initiative and left_at is null;
 update obligations set responsible_user_id=p_user where initiative_id=p_initiative and status in ('open','missed');
 perform audit('lead_transferred','initiative',p_initiative,jsonb_build_object('from',old_lead,'to',p_user)); end $$;
create function public.leave_initiative(p_initiative uuid,p_user uuid default auth.uid()) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.is_approved() or not(p_user=auth.uid() or public.is_admin() or exists(select 1 from initiatives where id=p_initiative and lead_id=auth.uid())) then raise exception 'membership authority required'; end if;
 if exists(select 1 from initiatives where id=p_initiative and lead_id=p_user) then raise exception 'transfer leadership first'; end if;
 update initiative_memberships set left_at=now() where initiative_id=p_initiative and user_id=p_user and left_at is null; perform audit('member_left','initiative',p_initiative,jsonb_build_object('user',p_user)); end $$;
create function public.set_policy(p_penalty int,p_reward int) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 if p_penalty<0 or p_penalty>100 or p_reward<0 or p_reward>100 then raise exception 'points must be 0 to 100'; end if;
 update system_policy set penalty=p_penalty,reward=p_reward,version=version+1; perform audit('policy_changed','policy',null,jsonb_build_object('penalty',p_penalty,'reward',p_reward)); end $$;
create function public.read_notification(p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.is_approved() then raise exception 'approval required'; end if;
 update notifications set read_at=now() where id=p_id and user_id=auth.uid(); end $$;
create function public.set_cycle_break(p_cycle uuid,p_break boolean) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 if exists(select 1 from obligations where cycle_id=p_cycle and status='submitted') then raise exception 'cannot change a cycle with submitted work'; end if;
 update cycles set is_break=p_break where id=p_cycle;
 if p_break then update obligations set status='waived',waiver_reason='Break week',waived_at=now(),waived_by=auth.uid() where cycle_id=p_cycle and status in ('open','missed');
 insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id) select e.initiative_id,'reversal',-e.points,e.obligation_id,e.id,'break week',auth.uid() from hp_events e join obligations o on o.id=e.obligation_id where o.cycle_id=p_cycle and e.kind='penalty' on conflict do nothing;
 else raise exception 'create the next working cycle explicitly instead of reopening waived work'; end if;
 perform audit('cycle_break','cycle',p_cycle,jsonb_build_object('break',p_break)); end $$;
-- Private image reads follow current account approval, including non-team reviewers.
drop policy initiative_images_read on storage.objects;
create policy initiative_images_read on storage.objects for select using(bucket_id='initiative-images' and public.is_approved());
drop policy initiative_images_delete on storage.objects;
create policy initiative_images_delete on storage.objects for delete using(bucket_id='initiative-images' and public.is_approved() and exists(select 1 from initiatives i where i.id::text=(storage.foldername(name))[1] and (i.lead_id=auth.uid() or public.is_admin())));
revoke all on function transfer_lead(uuid,uuid),leave_initiative(uuid,uuid),set_policy(integer,integer),read_notification(uuid),set_cycle_break(uuid,boolean) from public,anon;
grant execute on function transfer_lead(uuid,uuid),leave_initiative(uuid,uuid),set_policy(integer,integer),read_notification(uuid),set_cycle_break(uuid,boolean) to authenticated;
-- Protect tables even when Supabase default privileges grant broad SQL access.
revoke insert,update,delete on all tables in schema public from anon,authenticated;
