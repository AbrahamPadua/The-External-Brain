-- The External Brain UCSD: initial production schema. Apply through Supabase migrations.
create extension if not exists pgcrypto;

create type public.account_status as enum ('pending','approved','rejected','suspended');
create type public.initiative_status as enum ('active','on_hold','completed','stopped','dead');
create type public.proposal_status as enum ('draft','submitted','changes_requested','approved','rejected');
create type public.membership_role as enum ('member','lead');
create type public.obligation_kind as enum ('rm','review');
create type public.obligation_status as enum ('open','submitted','waived','missed','superseded');
create type public.document_kind as enum ('rm','review');
create type public.hp_event_kind as enum ('reward','penalty','reversal','adjustment');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  account_status public.account_status not null default 'pending',
  decision_reason text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.role_grants (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('operations','research')), granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(), revoked_at timestamptz, revoked_by uuid references public.profiles(id),
  unique(user_id, role, revoked_at)
);
create table public.proposals (
  id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id), title text not null,
  summary text not null default '', content jsonb not null default '{"blocks":[]}', status public.proposal_status not null default 'draft',
  decision_reason text, decided_by uuid references public.profiles(id), decided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.initiatives (
  id uuid primary key default gen_random_uuid(), proposal_id uuid unique references public.proposals(id), title text not null,
  summary text not null default '', content jsonb not null default '{"blocks":[]}', status public.initiative_status not null default 'active',
  lead_id uuid not null references public.profiles(id), hp_legacy integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz
);
create table public.initiative_memberships (
  id uuid primary key default gen_random_uuid(), initiative_id uuid not null references public.initiatives(id) on delete cascade,
  user_id uuid not null references public.profiles(id), role public.membership_role not null default 'member', joined_at timestamptz not null default now(), left_at timestamptz,
  unique(initiative_id,user_id, left_at)
);
create table public.join_requests (
  id uuid primary key default gen_random_uuid(), initiative_id uuid not null references public.initiatives(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id), message text not null default '', status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decided_by uuid references public.profiles(id), decided_at timestamptz, decision_reason text, created_at timestamptz not null default now(),
  unique(initiative_id,applicant_id,status) deferrable initially immediate
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), initiative_id uuid not null references public.initiatives(id) on delete cascade,
  title text not null, details text not null default '', status text not null default 'open' check(status in ('open','done','cancelled')),
  assignee_id uuid references public.profiles(id), due_at timestamptz, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.cycles (
  id uuid primary key default gen_random_uuid(), starts_on date not null, rm_due_at timestamptz not null, review_due_at timestamptz not null,
  is_break boolean not null default false, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), unique(starts_on), check(review_due_at > rm_due_at)
);
create table public.obligations (
  id uuid primary key default gen_random_uuid(), cycle_id uuid not null references public.cycles(id) on delete cascade,
  initiative_id uuid not null references public.initiatives(id) on delete cascade, kind public.obligation_kind not null,
  responsible_user_id uuid not null references public.profiles(id), assigned_by uuid references public.profiles(id), assigned_at timestamptz,
  due_at timestamptz not null, status public.obligation_status not null default 'open', submitted_at timestamptz, waived_at timestamptz,
  waived_by uuid references public.profiles(id), waiver_reason text, supersedes_id uuid references public.obligations(id), created_at timestamptz not null default now(),
  unique(cycle_id,initiative_id,kind)
);
create table public.documents (
  id uuid primary key default gen_random_uuid(), obligation_id uuid not null unique references public.obligations(id) on delete cascade,
  kind public.document_kind not null, initiative_id uuid not null references public.initiatives(id), author_id uuid not null references public.profiles(id),
  reviewed_document_id uuid references public.documents(id), reviewed_version_number integer, submitted_version_number integer, created_at timestamptz not null default now()
);
create table public.document_versions (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade,
  version_number integer not null, content jsonb not null default '{"blocks":[]}', submitted_at timestamptz,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), unique(document_id,version_number)
);
create table public.comment_threads (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade,
  version_number integer not null, block_id text not null, quote text, resolved_at timestamptz, resolved_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  foreign key(document_id,version_number) references public.document_versions(document_id,version_number)
);
create table public.comments (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.comment_threads(id) on delete cascade,
  parent_id uuid references public.comments(id), body text not null, author_id uuid not null references public.profiles(id), created_at timestamptz not null default now(), edited_at timestamptz
);
create table public.hp_events (
  id uuid primary key default gen_random_uuid(), initiative_id uuid not null references public.initiatives(id) on delete cascade,
  kind public.hp_event_kind not null, points integer not null, obligation_id uuid references public.obligations(id), reversed_event_id uuid unique references public.hp_events(id),
  policy_version text not null default '2026-09-09', reason text not null, actor_id uuid references public.profiles(id), created_at timestamptz not null default now(),
  check((kind <> 'reversal') or reversed_event_id is not null)
);
create unique index hp_one_penalty_per_obligation on public.hp_events(obligation_id) where kind='penalty';
create unique index hp_one_reward_per_obligation on public.hp_events(obligation_id) where kind='reward';
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, kind text not null, payload jsonb not null default '{}', read_at timestamptz, created_at timestamptz not null default now());
create table public.audit_events (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now());

create function public.is_approved(uid uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=uid and account_status='approved') $$;
create function public.has_role(role_name text, uid uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from role_grants where user_id=uid and role=role_name and revoked_at is null) $$;
create function public.is_admin(uid uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select public.has_role('operations',uid) or public.has_role('research',uid) $$;
create function public.is_member(i uuid, uid uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from initiative_memberships where initiative_id=i and user_id=uid and left_at is null) $$;
create function public.can_access_initiative(i uuid, uid uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select public.is_approved(uid) and (public.is_admin(uid) or public.is_member(i,uid)) $$;
create function public.hp_balance(i uuid) returns integer language sql stable security definer set search_path=public as $$ select greatest(0,least(100,coalesce(sum(points),0)))::integer from hp_events where initiative_id=i $$;

create function public.audit(p_action text,p_type text,p_id uuid,p_detail jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$ begin insert into audit_events(actor_id,action,entity_type,entity_id,detail) values(auth.uid(),p_action,p_type,p_id,p_detail); end $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','')); return new; end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.handle_new_user();

create function public.decide_account(p_user uuid,p_status public.account_status,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'admin required'; end if; if p_user=auth.uid() then raise exception 'self approval forbidden'; end if;
 if p_status not in ('approved','rejected','suspended') then raise exception 'invalid decision'; end if;
 update profiles set account_status=p_status,decision_reason=p_reason,decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=p_user;
 if not found then raise exception 'unknown account'; end if; perform public.audit('account_decided','profile',p_user,jsonb_build_object('status',p_status));
end $$;
create function public.grant_role(p_user uuid,p_role text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.has_role('operations') then raise exception 'operations required'; end if; if p_user=auth.uid() then raise exception 'self grant forbidden'; end if; insert into role_grants(user_id,role,granted_by) values(p_user,p_role,auth.uid()) on conflict(user_id,role,revoked_at) do nothing; perform public.audit('role_granted','profile',p_user,jsonb_build_object('role',p_role)); end $$;
create function public.decide_proposal(p_proposal uuid,p_status public.proposal_status,p_reason text default null) returns uuid language plpgsql security definer set search_path=public as $$ declare p proposals%rowtype; i uuid; begin
 if not public.has_role('research') then raise exception 'research required'; end if; select * into p from proposals where id=p_proposal for update; if not found or p.status not in ('submitted','changes_requested') then raise exception 'proposal not actionable'; end if;
 update proposals set status=p_status,decision_reason=p_reason,decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=p_proposal;
 if p_status='approved' then insert into initiatives(proposal_id,title,summary,content,lead_id) values(p.id,p.title,p.summary,p.content,p.author_id) returning id into i; insert into initiative_memberships(initiative_id,user_id,role) values(i,p.author_id,'lead'); end if;
 perform public.audit('proposal_decided','proposal',p_proposal,jsonb_build_object('status',p_status)); return i; end $$;
create function public.decide_join_request(p_request uuid,p_approve boolean,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$ declare r join_requests%rowtype; begin
 select * into r from join_requests where id=p_request for update; if not found or r.status<>'pending' then raise exception 'request not actionable'; end if;
 if not (public.is_admin() or exists(select 1 from initiatives where id=r.initiative_id and lead_id=auth.uid())) then raise exception 'lead or admin required'; end if;
 update join_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now(),decision_reason=p_reason where id=p_request;
 if p_approve then insert into initiative_memberships(initiative_id,user_id) values(r.initiative_id,r.applicant_id) on conflict(initiative_id,user_id,left_at) do nothing; end if;
 perform public.audit('join_decided','join_request',p_request,jsonb_build_object('approved',p_approve)); end $$;
create function public.submit_obligation(p_obligation uuid,p_content jsonb,p_reviewed_document uuid default null,p_reviewed_version integer default null) returns uuid language plpgsql security definer set search_path=public as $$ declare o obligations%rowtype; d uuid; v integer; late boolean; penalty uuid; begin
 select * into o from obligations where id=p_obligation for update; if not found or o.status not in ('open','missed') then raise exception 'obligation not submittable'; end if;
 if o.responsible_user_id<>auth.uid() then raise exception 'responsible user required'; end if;
 select id,coalesce(max(version_number),0)+1 into d,v from documents left join document_versions on document_id=documents.id where obligation_id=o.id group by id;
 if d is null then insert into documents(obligation_id,kind,initiative_id,author_id,reviewed_document_id,reviewed_version_number) values(o.id,o.kind,o.initiative_id,auth.uid(),p_reviewed_document,p_reviewed_version) returning id into d; v:=1; end if;
 insert into document_versions(document_id,version_number,content,submitted_at,created_by) values(d,v,p_content,now(),auth.uid()); late:=now()>o.due_at;
 update obligations set status='submitted',submitted_at=now() where id=o.id; update documents set submitted_version_number=v where id=d;
 if late then select id into penalty from hp_events where obligation_id=o.id and kind='penalty'; if penalty is not null then insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id) values(o.initiative_id,'reversal',10,o.id,penalty,'late completion reverses missed obligation',auth.uid()) on conflict(reversed_event_id) do nothing; end if; end if;
 insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id) values(o.initiative_id,'reward',4,o.id,'submitted obligation',auth.uid()) on conflict do nothing;
 perform public.audit('obligation_submitted','obligation',o.id,jsonb_build_object('late',late)); return d; end $$;
create function public.assign_review(p_obligation uuid,p_reviewer uuid,p_due_at timestamptz default null) returns void language plpgsql security definer set search_path=public as $$ declare o obligations%rowtype; begin
 if not public.has_role('research') then raise exception 'research required'; end if; select * into o from obligations where id=p_obligation for update; if not found or o.kind<>'review' or o.status not in ('open','missed') then raise exception 'review not assignable'; end if;
 if exists(select 1 from initiative_memberships where initiative_id=o.initiative_id and user_id=p_reviewer and left_at is null) then raise exception 'cannot review own initiative'; end if;
 update obligations set responsible_user_id=p_reviewer,assigned_by=auth.uid(),assigned_at=now(),due_at=coalesce(p_due_at,o.due_at) where id=p_obligation; perform public.audit('review_assigned','obligation',p_obligation,jsonb_build_object('reviewer',p_reviewer)); end $$;
create function public.evaluate_due_obligations(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 with changed as (update obligations set status='missed' where status='open' and due_at<p_now returning *) insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id) select initiative_id,'penalty',-10,id,'missed obligation',auth.uid() from changed on conflict do nothing;
 get diagnostics n=row_count; return n; end $$;
create function public.set_initiative_status(p_initiative uuid,p_status public.initiative_status,p_reason text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 update initiatives set status=p_status,closed_at=case when p_status in ('completed','stopped','dead') then now() else null end,updated_at=now() where id=p_initiative;
 if not found then raise exception 'unknown initiative'; end if;
 if p_status in ('on_hold','completed','stopped','dead') then update obligations set status='waived',waived_at=now(),waived_by=auth.uid(),waiver_reason=p_reason where initiative_id=p_initiative and status in ('open','missed'); end if;
 perform public.audit('initiative_status_changed','initiative',p_initiative,jsonb_build_object('status',p_status,'reason',p_reason)); end $$;

alter table public.profiles enable row level security; alter table public.role_grants enable row level security; alter table public.proposals enable row level security; alter table public.initiatives enable row level security; alter table public.initiative_memberships enable row level security; alter table public.join_requests enable row level security; alter table public.tasks enable row level security; alter table public.cycles enable row level security; alter table public.obligations enable row level security; alter table public.documents enable row level security; alter table public.document_versions enable row level security; alter table public.comment_threads enable row level security; alter table public.comments enable row level security; alter table public.hp_events enable row level security; alter table public.notifications enable row level security; alter table public.audit_events enable row level security;
create policy profiles_own_or_admin on profiles for select using (id=auth.uid() or public.is_admin()); create policy profiles_self_update on profiles for update using(id=auth.uid()) with check(id=auth.uid() and account_status=(select account_status from profiles where id=auth.uid()));
create policy roles_admin on role_grants for select using(public.is_admin());
create policy public_initiatives on initiatives for select using(status='active'); create policy internal_initiatives on initiatives for select using(public.can_access_initiative(id));
create policy proposals_access on proposals for select using((author_id=auth.uid() and public.is_approved()) or public.has_role('research')); create policy proposals_insert on proposals for insert with check(author_id=auth.uid() and public.is_approved()); create policy proposals_update on proposals for update using(author_id=auth.uid() and status in ('draft','changes_requested')) with check(author_id=auth.uid() and public.is_approved());
create policy memberships_access on initiative_memberships for select using(public.can_access_initiative(initiative_id));
create policy joins_access on join_requests for select using((applicant_id=auth.uid() and public.is_approved()) or public.can_access_initiative(initiative_id)); create policy joins_insert on join_requests for insert with check(applicant_id=auth.uid() and public.is_approved());
create policy tasks_access on tasks for select using(public.can_access_initiative(initiative_id)); create policy cycles_approved on cycles for select using(public.is_approved()); create policy obligations_access on obligations for select using(public.can_access_initiative(initiative_id) or responsible_user_id=auth.uid());
create policy docs_access on documents for select using(public.can_access_initiative(initiative_id)); create policy versions_access on document_versions for select using(exists(select 1 from documents d where d.id=document_id and public.can_access_initiative(d.initiative_id))); create policy threads_access on comment_threads for select using(exists(select 1 from documents d where d.id=document_id and public.can_access_initiative(d.initiative_id))); create policy comments_access on comments for select using(exists(select 1 from comment_threads t join documents d on d.id=t.document_id where t.id=thread_id and public.can_access_initiative(d.initiative_id)));
create policy hp_access on hp_events for select using(public.can_access_initiative(initiative_id)); create policy notifications_own on notifications for select using(user_id=auth.uid() and public.is_approved()); create policy audit_admin on audit_events for select using(public.is_admin());
-- Draft/comment writes are deliberately RPC-only except proposal and join request creation.
insert into storage.buckets(id,name,public) values('initiative-images','initiative-images',false) on conflict do nothing;
create policy initiative_images_read on storage.objects for select using(bucket_id='initiative-images' and public.is_approved() and exists(select 1 from public.initiative_memberships m where m.initiative_id::text=(storage.foldername(name))[1] and m.user_id=auth.uid() and m.left_at is null));
