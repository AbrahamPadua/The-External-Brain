-- Approval is independent of initiative participation. All privileged commands
-- check current database standing, not a possibly stale JWT role claim.
create or replace function public.has_role(role_name text, uid uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_approved(uid) and exists(select 1 from role_grants where user_id=uid and role=role_name and revoked_at is null) $$;
create or replace function public.can_access_initiative(i uuid,uid uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select public.is_approved(uid) and exists(select 1 from initiatives where id=i) $$;
create function public.can_edit_document(did uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_approved() and exists(select 1 from documents d join obligations o on o.id=d.obligation_id where d.id=did and ((d.kind='rm' and public.is_member(d.initiative_id)) or (d.kind='review' and o.responsible_user_id=auth.uid()))) $$;
create function public.can_read_document(did uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_approved() and exists(select 1 from documents d where d.id=did and (d.submitted_version_number is not null or public.can_edit_document(d.id))) $$;
drop policy profiles_self_update on profiles;
drop policy profiles_own_or_admin on profiles;
create policy profiles_visibility on profiles for select using(id=auth.uid() or public.is_admin() or (public.is_approved() and account_status='approved'));
drop policy roles_admin on role_grants;
create policy roles_visibility on role_grants for select using(public.is_approved());
drop policy public_initiatives on initiatives;
drop policy internal_initiatives on initiatives;
create policy internal_initiatives on initiatives for select using(public.is_approved());
-- Deliberately project only approved public summary fields, never working content.
create view public.initiative_catalog as select id,title,summary,status from public.initiatives where status='active';
grant select on public.initiative_catalog to anon,authenticated;
drop policy obligations_access on obligations;
create policy obligations_access on obligations for select using(public.is_approved());
drop policy docs_access on documents;
create policy docs_access on documents for select using(public.can_read_document(id));
drop policy versions_access on document_versions;
create policy versions_access on document_versions for select using(public.can_read_document(document_id));
drop policy drafts_team_access on document_drafts;
create policy drafts_team_access on document_drafts for select using(public.can_edit_document(document_id));
drop policy threads_access on comment_threads;
create policy threads_access on comment_threads for select using(public.can_read_document(document_id));
drop policy comments_access on comments;
create policy comments_access on comments for select using(public.is_approved() and exists(select 1 from comment_threads t where t.id=thread_id and public.can_read_document(t.document_id)));
drop policy joins_access on join_requests;
create policy joins_access on join_requests for select using(public.is_approved() and (applicant_id=auth.uid() or public.is_admin() or exists(select 1 from initiatives i where i.id=initiative_id and i.lead_id=auth.uid())));
drop policy proposals_insert on proposals;
drop policy proposals_update on proposals;
drop policy joins_insert on join_requests;
-- Application writes use commands; clients cannot forge decision columns.
create function public.save_proposal(p_title text,p_summary text,p_content jsonb,p_submit boolean default false,p_id uuid default null) returns uuid language plpgsql security definer set search_path=public as $$ declare pid uuid; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 if p_submit and (length(trim(p_title))=0 or length(trim(p_summary))=0) then raise exception 'title and abstract required'; end if;
 if p_id is null then insert into proposals(author_id,title,summary,content,status) values(auth.uid(),p_title,p_summary,p_content,case when p_submit then 'submitted'::proposal_status else 'draft'::proposal_status end) returning id into pid;
 else update proposals set title=p_title,summary=p_summary,content=p_content,status=case when p_submit then 'submitted'::proposal_status else 'draft'::proposal_status end,updated_at=now() where id=p_id and author_id=auth.uid() and status in ('draft','changes_requested') returning id into pid; if pid is null then raise exception 'proposal is not editable'; end if; end if;
 perform audit('proposal_saved','proposal',pid,jsonb_build_object('submitted',p_submit)); return pid; end $$;
create function public.request_join(p_initiative uuid,p_message text default '') returns uuid language plpgsql security definer set search_path=public as $$ declare rid uuid; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 if public.is_member(p_initiative) then raise exception 'already a member'; end if;
 if not exists(select 1 from initiatives where id=p_initiative and status='active') then raise exception 'initiative unavailable'; end if;
 insert into join_requests(initiative_id,applicant_id,message) values(p_initiative,auth.uid(),p_message) returning id into rid; return rid; end $$;
create or replace function public.decide_join_request(p_request uuid,p_approve boolean,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$ declare r join_requests%rowtype; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 select * into r from join_requests where id=p_request for update;
 if not found then raise exception 'unknown request'; end if;
 if not(public.is_admin() or exists(select 1 from initiatives where id=r.initiative_id and lead_id=auth.uid())) then raise exception 'lead or admin required'; end if;
 if r.status<>'pending' then return; end if;
 if p_approve and not public.is_approved(r.applicant_id) then raise exception 'applicant must be approved'; end if;
 update join_requests set status=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now(),decision_reason=p_reason where id=r.id;
 if p_approve then insert into initiative_memberships(initiative_id,user_id) values(r.initiative_id,r.applicant_id) on conflict do nothing; end if;
 insert into notifications(user_id,kind,payload) values(r.applicant_id,'join_decided',jsonb_build_object('approved',p_approve));
 perform audit('join_decided','join_request',r.id,jsonb_build_object('approved',p_approve,'reason',p_reason)); end $$;
create or replace function public.decide_proposal(p_proposal uuid,p_status public.proposal_status,p_reason text default null) returns uuid language plpgsql security definer set search_path=public as $$ declare p proposals%rowtype; i uuid; begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 if p_status not in ('approved','rejected','changes_requested') then raise exception 'invalid decision'; end if;
 select * into p from proposals where id=p_proposal for update; if not found then raise exception 'unknown proposal'; end if;
 if p.status='approved' and p_status='approved' then select id into i from initiatives where proposal_id=p.id; return i; end if;
 if p.status<>'submitted' then raise exception 'proposal not submitted'; end if;
 if p_status='approved' and not public.is_approved(p.author_id) then raise exception 'author not approved'; end if;
 update proposals set status=p_status,decision_reason=p_reason,decided_by=auth.uid(),decided_at=now() where id=p.id;
 if p_status='approved' then insert into initiatives(proposal_id,title,summary,content,lead_id) values(p.id,p.title,p.summary,p.content,p.author_id) returning id into i; insert into initiative_memberships(initiative_id,user_id,role) values(i,p.author_id,'lead'); end if;
 insert into notifications(user_id,kind,payload) values(p.author_id,'proposal_decided',jsonb_build_object('status',p_status));
 perform audit('proposal_decided','proposal',p.id,jsonb_build_object('status',p_status,'reason',p_reason)); return i; end $$;

alter table obligations add column target_document_id uuid references documents(id);
alter table obligations add column target_version integer;
alter table initiatives add column activated_at timestamptz not null default now();
create table public.system_policy (id boolean primary key default true check(id),max_hp int not null default 100 check(max_hp>0),starting_hp int not null default 100 check(starting_hp>=0),penalty int not null default 10 check(penalty>=0),reward int not null default 4 check(reward>=0),version int not null default 1);
insert into system_policy default values;
alter table system_policy enable row level security;
create policy policy_read on system_policy for select using(public.is_approved());
alter table hp_events add column sequence bigint generated always as identity;
create or replace function public.hp_balance(i uuid) returns integer language plpgsql stable security definer set search_path=public as $$ declare balance int; maximum int; ev record; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 select starting_hp,max_hp into balance,maximum from system_policy;
 for ev in select e.points from hp_events e where e.initiative_id=i and e.kind<>'reversal' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id) order by e.sequence loop balance:=greatest(0,least(maximum,balance+ev.points)); end loop; return balance; end $$;
create function public.adjust_hp(p_initiative uuid,p_points int,p_reason text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.has_role('research') or length(trim(p_reason))=0 then raise exception 'research and reason required'; end if;
 insert into hp_events(initiative_id,kind,points,reason,actor_id) values(p_initiative,'adjustment',p_points,p_reason,auth.uid()); perform audit('hp_adjusted','initiative',p_initiative,jsonb_build_object('points',p_points,'reason',p_reason)); end $$;
create function public.open_cycle(p_monday date,p_break boolean default false) returns uuid language plpgsql security definer set search_path=public as $$ declare cid uuid; begin
 if not public.has_role('research') and coalesce(auth.role(),'')<>'service_role' then raise exception 'research required'; end if;
 if extract(isodow from p_monday)<>1 then raise exception 'cycle must start Monday'; end if;
 insert into cycles(starts_on,rm_due_at,review_due_at,is_break,created_by) values(p_monday,((p_monday+4)+time '23:59') at time zone 'America/Los_Angeles',((p_monday+6)+time '23:59') at time zone 'America/Los_Angeles',p_break,auth.uid()) on conflict(starts_on) do nothing;
 select id into cid from cycles where starts_on=p_monday;
 if not (select is_break from cycles where id=cid) then
 insert into obligations(cycle_id,initiative_id,kind,responsible_user_id,due_at) select cid,i.id,k.kind::obligation_kind,i.lead_id,case when k.kind='rm' then c.rm_due_at else c.review_due_at end from initiatives i cross join (values('rm'),('review')) k(kind) join cycles c on c.id=cid where i.status='active' and i.activated_at<(p_monday::timestamp at time zone 'America/Los_Angeles') on conflict do nothing;
 end if; return cid; end $$;
create function public.assign_review_target(p_obligation uuid,p_target uuid,p_due_at timestamptz default null) returns void language plpgsql security definer set search_path=public as $$ declare o obligations%rowtype; target documents%rowtype; begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 select * into o from obligations where id=p_obligation for update; select * into target from documents where id=p_target;
 if o.id is null or o.kind<>'review' or o.status not in ('open','missed') or target.id is null or target.kind<>'rm' or target.submitted_version_number is null then raise exception 'invalid review assignment'; end if;
 if public.is_member(target.initiative_id,o.responsible_user_id) or target.initiative_id=o.initiative_id then raise exception 'cannot review own initiative'; end if;
 if coalesce(p_due_at,o.due_at)<=now() then raise exception 'replacement needs future deadline'; end if;
 insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id) select initiative_id,'reversal',-points,obligation_id,id,'reassigned obligation',auth.uid() from hp_events where obligation_id=o.id and kind='penalty' on conflict do nothing;
 update obligations set target_document_id=p_target,target_version=target.submitted_version_number,assigned_by=auth.uid(),assigned_at=now(),due_at=coalesce(p_due_at,o.due_at),status='open' where id=o.id;
 insert into notifications(user_id,kind,payload) values(o.responsible_user_id,'review_assigned',jsonb_build_object('obligation_id',o.id));
 perform audit('review_assigned','obligation',o.id,jsonb_build_object('target',p_target)); end $$;
-- Replace unsafe upsert autosave with optimistic revision checks.
create function public.save_document_draft(p_obligation uuid,p_content jsonb,p_revision int default null) returns uuid language plpgsql security definer set search_path=public as $$ declare o obligations%rowtype; did uuid; rev int; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 select * into o from obligations where id=p_obligation for update; if not found or o.status not in ('open','missed','submitted') then raise exception 'draft unavailable'; end if;
 if not((o.kind='rm' and public.is_member(o.initiative_id)) or (o.kind='review' and o.responsible_user_id=auth.uid() and o.target_document_id is not null)) then raise exception 'draft authority required'; end if;
 select id into did from documents where obligation_id=o.id;
 if did is null then insert into documents(obligation_id,kind,initiative_id,author_id) values(o.id,o.kind::text::document_kind,o.initiative_id,o.responsible_user_id) returning id into did; end if;
 select revision into rev from document_drafts where document_id=did;
 if rev is not null and p_revision is distinct from rev then raise exception 'draft conflict: reload before saving'; end if;
 insert into document_drafts(document_id,content,updated_by) values(did,p_content,auth.uid()) on conflict(document_id) do update set content=excluded.content,revision=document_drafts.revision+1,updated_by=auth.uid(),updated_at=now(); return did; end $$;
create or replace function public.submit_obligation(p_obligation uuid,p_content jsonb,p_reviewed_document uuid default null,p_reviewed_version integer default null) returns uuid language plpgsql security definer set search_path=public as $$ declare o obligations%rowtype; did uuid; v int; p system_policy%rowtype; begin
 if not public.is_approved() then raise exception 'approved account required'; end if;
 select * into o from obligations where id=p_obligation for update; if not found or o.status not in ('open','missed','submitted') then raise exception 'not submittable'; end if;
 if o.responsible_user_id<>auth.uid() then raise exception 'responsible lead required'; end if;
 if o.kind='review' and (o.target_document_id is null or p_reviewed_document is distinct from o.target_document_id or p_reviewed_version is distinct from o.target_version) then raise exception 'review must reference assigned RM version'; end if;
 select id into did from documents where obligation_id=o.id;
 if did is null then insert into documents(obligation_id,kind,initiative_id,author_id,reviewed_document_id,reviewed_version_number) values(o.id,o.kind::text::document_kind,o.initiative_id,auth.uid(),o.target_document_id,o.target_version) returning id into did; end if;
 if o.status='submitted' and exists(select 1 from document_versions where document_id=did and version_number=(select submitted_version_number from documents where id=did) and content=p_content) then return did; end if;
 select coalesce(max(version_number),0)+1 into v from document_versions where document_id=did;
 insert into document_versions(document_id,version_number,content,submitted_at,created_by) values(did,v,p_content,now(),auth.uid());
 update documents set submitted_version_number=v,reviewed_document_id=o.target_document_id,reviewed_version_number=o.target_version where id=did;
 update obligations set status='submitted',submitted_at=coalesce(submitted_at,now()) where id=o.id;
 delete from document_drafts where document_id=did;
 select * into p from system_policy;
 insert into hp_events(initiative_id,kind,points,obligation_id,reversed_event_id,reason,actor_id) select initiative_id,'reversal',-points,obligation_id,id,'late completion reverses penalty',auth.uid() from hp_events where obligation_id=o.id and kind='penalty' on conflict do nothing;
 insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id,policy_version) values(o.initiative_id,'reward',p.reward,o.id,'completed obligation',auth.uid(),p.version::text) on conflict do nothing;
 perform audit('document_submitted','document',did,jsonb_build_object('version',v)); return did; end $$;
create or replace function public.evaluate_due_obligations(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path=public as $$ declare n int; p system_policy%rowtype; begin
 if not public.has_role('research') and coalesce(auth.role(),'')<>'service_role' then raise exception 'research required'; end if;
 if p_now>now() then raise exception 'cannot evaluate future deadlines'; end if;
 select * into p from system_policy;
 with changed as(update obligations o set status='missed' where status='open' and due_at<p_now and (kind='rm' or target_document_id is not null) and exists(select 1 from initiatives where id=o.initiative_id and status='active') and exists(select 1 from cycles where id=o.cycle_id and not is_break) returning *) insert into hp_events(initiative_id,kind,points,obligation_id,reason,actor_id,policy_version) select initiative_id,'penalty',-p.penalty,id,'missed obligation',auth.uid(),p.version::text from changed on conflict do nothing;
 get diagnostics n=row_count; return n; end $$;
create or replace function public.add_comment(p_document uuid,p_version integer,p_block_id text,p_body text,p_thread uuid default null,p_parent uuid default null,p_quote text default null) returns uuid language plpgsql security definer set search_path=public as $$ declare tid uuid; cid uuid; begin
 if not public.can_read_document(p_document) or not exists(select 1 from document_versions where document_id=p_document and version_number=p_version) then raise exception 'submitted document required'; end if;
 if length(trim(p_body))=0 or length(p_body)>20000 then raise exception 'comment must contain 1 to 20000 characters'; end if;
 if p_thread is null then insert into comment_threads(document_id,version_number,block_id,quote,created_by) values(p_document,p_version,p_block_id,p_quote,auth.uid()) returning id into tid;
 else select id into tid from comment_threads where id=p_thread and document_id=p_document and version_number=p_version; if tid is null then raise exception 'invalid thread'; end if; end if;
 if p_parent is not null and not exists(select 1 from comments where id=p_parent and thread_id=tid) then raise exception 'reply parent must belong to thread'; end if;
 insert into comments(thread_id,parent_id,body,author_id) values(tid,p_parent,p_body,auth.uid()) returning id into cid; return cid; end $$;
create function public.change_role(p_user uuid,p_role text,p_enabled boolean) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.has_role('operations') or auth.uid()=p_user then raise exception 'operations required; no self changes'; end if;
 if p_enabled then perform grant_role(p_user,p_role); else update role_grants set revoked_at=now(),revoked_by=auth.uid() where user_id=p_user and role=p_role and revoked_at is null; end if;
 perform audit('role_changed','profile',p_user,jsonb_build_object('role',p_role,'enabled',p_enabled)); end $$;
create function public.prevent_history_mutation() returns trigger language plpgsql as $$ begin raise exception 'history is immutable'; end $$;
create trigger immutable_versions before update or delete on document_versions for each row execute function prevent_history_mutation();
create trigger immutable_hp before update or delete on hp_events for each row execute function prevent_history_mutation();
create trigger immutable_audit before update or delete on audit_events for each row execute function prevent_history_mutation();

-- Remove implicit PUBLIC execute. Internal helpers are not callable as commands.
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function is_approved(uuid),has_role(text,uuid),is_admin(uuid),is_member(uuid,uuid),can_access_initiative(uuid,uuid),can_read_document(uuid),can_edit_document(uuid) to anon,authenticated;
grant execute on function decide_account(uuid,account_status,text),grant_role(uuid,text),change_role(uuid,text,boolean),save_proposal(text,text,jsonb,boolean,uuid),request_join(uuid,text),decide_proposal(uuid,proposal_status,text),decide_join_request(uuid,boolean,text),create_task(uuid,text,text,uuid,timestamptz),update_task_status(uuid,text),save_document_draft(uuid,jsonb,integer),submit_obligation(uuid,jsonb,uuid,integer),assign_review_target(uuid,uuid,timestamptz),evaluate_due_obligations(timestamptz),open_cycle(date,boolean),set_initiative_status(uuid,initiative_status,text),hp_balance(uuid),adjust_hp(uuid,integer,text),add_comment(uuid,integer,text,text,uuid,uuid,text),resolve_comment_thread(uuid,boolean) to authenticated;
grant execute on function evaluate_due_obligations(timestamptz),open_cycle(date,boolean) to service_role;
grant select on all tables in schema public to authenticated;
grant usage on schema public to anon,authenticated,service_role;
