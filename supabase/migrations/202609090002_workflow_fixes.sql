-- Correct nullable uniqueness and add the small RPC surface required for daily work.
alter table public.role_grants drop constraint if exists role_grants_user_id_role_revoked_at_key;
alter table public.initiative_memberships drop constraint if exists initiative_memberships_initiative_id_user_id_left_at_key;
alter table public.join_requests drop constraint if exists join_requests_initiative_id_applicant_id_status_key;
create unique index role_grants_active_unique on public.role_grants(user_id,role) where revoked_at is null;
create unique index memberships_active_unique on public.initiative_memberships(initiative_id,user_id) where left_at is null;
create unique index join_requests_pending_unique on public.join_requests(initiative_id,applicant_id) where status='pending';

create or replace function public.grant_role(p_user uuid,p_role text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.has_role('operations') then raise exception 'operations required'; end if; if p_user=auth.uid() then raise exception 'self grant forbidden'; end if; insert into role_grants(user_id,role,granted_by) values(p_user,p_role,auth.uid()) on conflict do nothing; perform public.audit('role_granted','profile',p_user,jsonb_build_object('role',p_role)); end $$;
create or replace function public.decide_join_request(p_request uuid,p_approve boolean,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$ declare r join_requests%rowtype; begin
 select * into r from join_requests where id=p_request for update; if not found or r.status<>'pending' then raise exception 'request not actionable'; end if;
 if not (public.is_admin() or exists(select 1 from initiatives where id=r.initiative_id and lead_id=auth.uid())) then raise exception 'lead or admin required'; end if;
 update join_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now(),decision_reason=p_reason where id=p_request;
 if p_approve then insert into initiative_memberships(initiative_id,user_id) values(r.initiative_id,r.applicant_id) on conflict do nothing; end if;
 perform public.audit('join_decided','join_request',p_request,jsonb_build_object('approved',p_approve)); end $$;

create table public.document_drafts (
  document_id uuid primary key references public.documents(id) on delete cascade,
  content jsonb not null default '{"blocks":[]}', revision integer not null default 0,
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
alter table public.document_drafts enable row level security;
create policy drafts_team_access on public.document_drafts for select using(exists(select 1 from public.documents d where d.id=document_id and public.can_access_initiative(d.initiative_id)));

create function public.create_task(p_initiative uuid,p_title text,p_details text default '',p_assignee uuid default null,p_due_at timestamptz default null) returns uuid language plpgsql security definer set search_path=public as $$ declare t uuid; begin
 if not (public.is_admin() or exists(select 1 from initiatives where id=p_initiative and lead_id=auth.uid())) then raise exception 'lead or admin required'; end if;
 insert into tasks(initiative_id,title,details,assignee_id,due_at,created_by) values(p_initiative,p_title,p_details,p_assignee,p_due_at,auth.uid()) returning id into t; perform public.audit('task_created','task',t,'{}'); return t; end $$;
create function public.update_task_status(p_task uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$ declare i uuid; begin
 select initiative_id into i from tasks where id=p_task for update; if not found then raise exception 'unknown task'; end if; if not (public.is_admin() or exists(select 1 from initiatives where id=i and lead_id=auth.uid()) or exists(select 1 from tasks where id=p_task and assignee_id=auth.uid())) then raise exception 'task authority required'; end if; update tasks set status=p_status,updated_at=now() where id=p_task; perform public.audit('task_updated','task',p_task,jsonb_build_object('status',p_status)); end $$;
create function public.create_document_draft(p_obligation uuid,p_content jsonb) returns uuid language plpgsql security definer set search_path=public as $$ declare o obligations%rowtype; d uuid; begin
 select * into o from obligations where id=p_obligation for update; if not found or o.status not in ('open','missed') then raise exception 'draft unavailable'; end if;
 if not (o.responsible_user_id=auth.uid() or (o.kind='rm' and public.is_member(o.initiative_id,auth.uid()))) then raise exception 'team member required'; end if;
 select id into d from documents where obligation_id=o.id; if d is null then insert into documents(obligation_id,kind,initiative_id,author_id) values(o.id,o.kind,o.initiative_id,o.responsible_user_id) returning id into d; end if;
 insert into document_drafts(document_id,content,updated_by) values(d,p_content,auth.uid()) on conflict(document_id) do update set content=excluded.content,revision=document_drafts.revision+1,updated_by=auth.uid(),updated_at=now(); return d; end $$;
create function public.add_comment(p_document uuid,p_version integer,p_block_id text,p_body text,p_thread uuid default null,p_parent uuid default null,p_quote text default null) returns uuid language plpgsql security definer set search_path=public as $$ declare t uuid; c uuid; i uuid; begin
 select initiative_id into i from documents where id=p_document; if i is null or not public.can_access_initiative(i) then raise exception 'document access required'; end if;
 if p_thread is null then insert into comment_threads(document_id,version_number,block_id,quote,created_by) values(p_document,p_version,p_block_id,p_quote,auth.uid()) returning id into t; else select id into t from comment_threads where id=p_thread and document_id=p_document; if t is null then raise exception 'invalid thread'; end if; end if;
 insert into comments(thread_id,parent_id,body,author_id) values(t,p_parent,p_body,auth.uid()) returning id into c; perform public.audit('comment_added','comment',c,jsonb_build_object('thread',t)); return c; end $$;
create function public.resolve_comment_thread(p_thread uuid,p_resolved boolean) returns void language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from comment_threads t join documents d on d.id=t.document_id where t.id=p_thread and public.can_access_initiative(d.initiative_id)) then raise exception 'thread access required'; end if;
 update comment_threads set resolved_at=case when p_resolved then now() else null end,resolved_by=case when p_resolved then auth.uid() else null end where id=p_thread; end $$;
create or replace function public.set_initiative_status(p_initiative uuid,p_status public.initiative_status,p_reason text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 update initiatives set status=p_status,closed_at=case when p_status in ('completed','stopped','dead') then now() else null end,updated_at=now() where id=p_initiative;
 if not found then raise exception 'unknown initiative'; end if;
 if p_status in ('on_hold','completed','stopped','dead') then
   with waived as (update obligations set status='waived',waived_at=now(),waived_by=auth.uid(),waiver_reason=p_reason where initiative_id=p_initiative and status in ('open','missed') returning id,initiative_id)
   insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id)
   select w.initiative_id,'reversal',10,w.id,e.id,'waived obligation reverses missed penalty',auth.uid() from waived w join hp_events e on e.obligation_id=w.id and e.kind='penalty' on conflict(reversed_event_id) do nothing;
 end if;
 perform public.audit('initiative_status_changed','initiative',p_initiative,jsonb_build_object('status',p_status,'reason',p_reason)); end $$;

-- Secure storage uploads as well as reads. Path shape: {initiative-uuid}/{random-name}.
create policy initiative_images_insert on storage.objects for insert with check(bucket_id='initiative-images' and public.is_approved() and exists(select 1 from public.initiative_memberships m where m.initiative_id::text=(storage.foldername(name))[1] and m.user_id=auth.uid() and m.left_at is null));
create policy initiative_images_delete on storage.objects for delete using(bucket_id='initiative-images' and exists(select 1 from public.initiatives i where i.id::text=(storage.foldername(name))[1] and (i.lead_id=auth.uid() or public.is_admin())));
