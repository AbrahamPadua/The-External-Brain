-- Apply before the project-ideas frontend. Existing proposals remain own initiatives.
begin;

alter table public.proposals add column purpose text not null default 'own_initiative'
  check (purpose in ('own_initiative', 'project_idea'));

-- Keep the RPC signature: purpose travels in content, but is stored separately.
-- Older clients editing an idea omit purpose and retain its stored value.
create or replace function public.save_proposal(p_title text,p_summary text,p_content jsonb,p_submit boolean default false,p_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare pid uuid; existing proposals%rowtype; chosen_purpose text;
begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  if p_content is null or jsonb_typeof(p_content)<>'object' then raise exception 'proposal content must be an object'; end if;
  if p_id is not null then
    select * into existing from proposals where id=p_id for update;
    if not found or existing.author_id<>auth.uid() or existing.status not in ('draft','changes_requested') then
      raise exception 'proposal is not editable';
    end if;
  end if;
  chosen_purpose := case when p_content ? 'purpose' then p_content->>'purpose'
    else coalesce(existing.purpose,'own_initiative') end;
  if chosen_purpose is null or chosen_purpose not in ('own_initiative','project_idea') then
    raise exception 'invalid proposal purpose';
  end if;
  if p_submit and (length(trim(coalesce(p_title,'')))=0 or length(trim(coalesce(p_summary,'')))=0) then
    raise exception 'title and abstract required';
  end if;
  if p_submit and public.count_words(p_content->>'motivation') < 150 then
    raise exception 'motivation must be at least 150 words to submit (currently %)', public.count_words(p_content->>'motivation');
  end if;
  if p_submit and char_length(coalesce(p_content->>'motivation','')) > 20000 then
    raise exception 'motivation must be 20000 characters or fewer';
  end if;
  if p_id is null then
    insert into proposals(author_id,title,summary,content,purpose,status)
      values(auth.uid(),p_title,p_summary,p_content-'purpose',chosen_purpose,
        case when p_submit then 'submitted'::proposal_status else 'draft'::proposal_status end) returning id into pid;
  else
    update proposals set title=p_title,summary=p_summary,content=p_content-'purpose',purpose=chosen_purpose,
      status=case when p_submit then 'submitted'::proposal_status else 'draft'::proposal_status end,
      decision_reason=case when p_submit then null else decision_reason end,updated_at=now()
      where id=p_id returning id into pid;
  end if;
  perform audit('proposal_saved','proposal',pid,jsonb_build_object('submitted',p_submit,'purpose',chosen_purpose));
  return pid;
end $$;

create or replace function public.decide_proposal(p_proposal uuid,p_status public.proposal_status,p_reason text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare p proposals%rowtype; i uuid;
begin
  if not public.has_role('research') then raise exception 'research required'; end if;
  if p_status is null or p_status not in ('approved','rejected','changes_requested') then raise exception 'invalid decision'; end if;
  select * into p from proposals where id=p_proposal for update;
  if not found then raise exception 'unknown proposal'; end if;
  if p.status='approved' and p_status='approved' then
    select id into i from initiatives where proposal_id=p.id; return i;
  end if;
  if p.status<>'submitted' then raise exception 'proposal not submitted'; end if;
  if p_status<>'approved' and btrim(coalesce(p_reason,''))='' then raise exception 'decision feedback required'; end if;
  if p_status='approved' and not public.is_approved(p.author_id) then raise exception 'author not approved'; end if;
  if p_status='approved' and public.count_words(p.content->>'motivation') < 150 then
    raise exception 'motivation must be at least 150 words before approval (currently %)', public.count_words(p.content->>'motivation');
  end if;
  update proposals set status=p_status,decision_reason=p_reason,decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=p.id;
  if p_status='approved' and p.purpose='own_initiative' then
    insert into initiatives(proposal_id,title,summary,content,lead_id)
      values(p.id,p.title,p.summary,coalesce(p.content,'{}'::jsonb) ||
        jsonb_build_object('execution_plan',coalesce(p.content->>'html',''),'html','','abstract_from_overview',true),p.author_id)
      returning id into i;
    insert into initiative_memberships(initiative_id,user_id,role) values(i,p.author_id,'lead');
  end if;
  insert into notifications(user_id,kind,payload) values(p.author_id,'proposal_decided',
    jsonb_build_object('status',p_status,'purpose',p.purpose,'proposal_id',p.id,'initiative_id',i));
  perform audit('proposal_decided','proposal',p.id,jsonb_build_object('status',p_status,'purpose',p.purpose,'reason',p_reason));
  return i;
end $$;

create table public.idea_lead_requests (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id),
  applicant_id uuid not null references public.profiles(id),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','taken')),
  decided_by uuid references public.profiles(id), decided_at timestamptz, decision_reason text,
  created_at timestamptz not null default now()
);
create unique index idea_lead_one_pending on public.idea_lead_requests(proposal_id,applicant_id) where status='pending';
create index idea_lead_pending_queue on public.idea_lead_requests(created_at) where status='pending';
alter table public.idea_lead_requests enable row level security;
create policy idea_lead_private_read on public.idea_lead_requests for select
  using (public.is_approved() and (applicant_id=auth.uid() or public.has_role('research')));
revoke all on public.idea_lead_requests from anon,authenticated;
grant select on public.idea_lead_requests to authenticated;

-- Owner projection deliberately publishes only approved display content and credit.
-- Raw proposals, feedback and all applicant notes stay behind their existing RLS.
create view public.project_idea_catalog as
  select p.id,p.title,p.summary,coalesce(p.content->>'category','Research') as category,
    coalesce(p.content->>'html','') as execution_plan,coalesce(p.content->>'motivation','') as motivation,
    p.author_id as proposer_id,pr.display_name as proposer_name,i.id as initiative_id
  from public.proposals p join public.profiles pr on pr.id=p.author_id
  left join public.initiatives i on i.proposal_id=p.id
  where p.purpose='project_idea' and p.status='approved';
grant select on public.project_idea_catalog to anon,authenticated;

create function public.request_idea_lead(p_proposal uuid,p_message text) returns uuid
language plpgsql security definer set search_path=public as $$
declare p proposals%rowtype; rid uuid;
begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  -- All operations take the proposal lock first, including decisions. This
  -- serializes competing applications/acceptances without request-lock deadlocks.
  select * into p from proposals where id=p_proposal for update;
  if not found or p.purpose<>'project_idea' or p.status<>'approved'
    or exists(select 1 from initiatives where proposal_id=p.id) then raise exception 'idea unavailable'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 10 and 2000 then
    raise exception 'interest and availability note must be 10 to 2000 characters';
  end if;
  select id into rid from idea_lead_requests where proposal_id=p.id and applicant_id=auth.uid() and status='pending';
  if rid is not null then return rid; end if;
  insert into idea_lead_requests(proposal_id,applicant_id,message) values(p.id,auth.uid(),btrim(p_message)) returning id into rid;
  perform audit('idea_lead_requested','idea_lead_request',rid,jsonb_build_object('proposal_id',p.id));
  return rid;
end $$;

create function public.decide_idea_lead(p_request uuid,p_approve boolean,p_reason text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare r idea_lead_requests%rowtype; p proposals%rowtype; i uuid; other_request record;
begin
  if not public.has_role('research') then raise exception 'research required'; end if;
  if p_approve is null then raise exception 'invalid decision'; end if;
  select * into p from proposals where id=(select proposal_id from idea_lead_requests where id=p_request) for update;
  if not found then raise exception 'unknown lead request'; end if;
  select * into r from idea_lead_requests where id=p_request for update;
  select id into i from initiatives where proposal_id=p.id;
  if r.status<>'pending' then
    if p_approve and r.status in ('approved','taken') then return i; end if;
    if not p_approve and r.status='rejected' then return null; end if;
    raise exception 'lead request already decided';
  end if;
  if p.purpose<>'project_idea' or p.status<>'approved' or i is not null then raise exception 'idea unavailable'; end if;
  if not p_approve and btrim(coalesce(p_reason,''))='' then raise exception 'decision feedback required'; end if;
  if p_approve then
    -- Lock standing until the transaction finishes as well as checking it now.
    perform 1 from profiles where id=r.applicant_id and account_status='approved' for share;
    if not found then raise exception 'applicant must be approved'; end if;
    insert into initiatives(proposal_id,title,summary,content,lead_id)
      values(p.id,p.title,p.summary,p.content || jsonb_build_object(
        'execution_plan',coalesce(p.content->>'html',''),'html','','abstract_from_overview',true,
        'project_idea_id',p.id,'proposer_id',p.author_id,
        'proposer_name',(select display_name from profiles where id=p.author_id)),r.applicant_id) returning id into i;
    insert into initiative_memberships(initiative_id,user_id,role) values(i,r.applicant_id,'lead');
  end if;
  update idea_lead_requests set status=case when p_approve then 'approved' else 'rejected' end,
    decided_by=auth.uid(),decided_at=now(),decision_reason=p_reason where id=r.id;
  insert into notifications(user_id,kind,payload) values(r.applicant_id,'idea_lead_decided',
    jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end,'proposal_id',p.id,'initiative_id',i));
  perform audit('idea_lead_decided','idea_lead_request',r.id,
    jsonb_build_object('approved',p_approve,'proposal_id',p.id,'initiative_id',i,'reason',p_reason));
  if p_approve then
    for other_request in
      update idea_lead_requests set status='taken',decided_by=auth.uid(),decided_at=now()
        where proposal_id=p.id and status='pending' returning id,applicant_id
    loop
      insert into notifications(user_id,kind,payload) values(other_request.applicant_id,'idea_lead_decided',
        jsonb_build_object('status','taken','proposal_id',p.id,'initiative_id',i));
      perform audit('idea_lead_taken','idea_lead_request',other_request.id,jsonb_build_object('proposal_id',p.id,'initiative_id',i));
    end loop;
    insert into notifications(user_id,kind,payload) values(p.author_id,'project_idea_started',
      jsonb_build_object('proposal_id',p.id,'initiative_id',i,'lead_id',r.applicant_id));
    perform audit('project_idea_started','initiative',i,jsonb_build_object('proposal_id',p.id,'proposer_id',p.author_id,'lead_id',r.applicant_id));
  end if;
  -- No HP or obligations here: activated_at and the existing weekly cycle rules
  -- start reporting on the next eligible cycle, exactly as for own initiatives.
  return i;
end $$;
revoke all on function public.request_idea_lead(uuid,text),public.decide_idea_lead(uuid,boolean,text) from public,anon;
grant execute on function public.request_idea_lead(uuid,text),public.decide_idea_lead(uuid,boolean,text) to authenticated;

-- Append credit columns; preserve the existing public catalog's column order.
create or replace view public.initiative_catalog as
  select i.id, i.title, i.summary, i.status, i.lead_name,
    coalesce(i.content->>'category', '') as category,
    coalesce(i.content->>'html', '') as overview_html,
    coalesce(i.content->>'abstract_html', '') as abstract_html,
    coalesce(i.content->>'motivation', '') as motivation,
    coalesce(i.content->>'motivation_html', '') as motivation_html,
    i.cover_object_path, i.cover_fallback_color, i.cover_position_x, i.cover_position_y,
    coalesce(nullif(btrim(i.lead_name), ''), lead.display_name, '') as lead_display_name,
    (select count(*) from public.initiative_memberships m where m.initiative_id = i.id and m.left_at is null)::integer as member_count,
    i.lead_id, public.initiative_hp(i.id) as hp,
    coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name) order by m.joined_at)
      from public.initiative_memberships m join public.profiles pr on pr.id = m.user_id
      where m.initiative_id = i.id and m.left_at is null), '[]'::jsonb) as members,
    coalesce(i.content->>'execution_plan', '') as execution_plan,
    idea.id as project_idea_id,idea.author_id as proposer_id,proposer.display_name as proposer_name
  from public.initiatives i left join public.profiles lead on lead.id=i.lead_id
  left join public.proposals idea on idea.id=i.proposal_id and idea.purpose='project_idea' and idea.status='approved'
  left join public.profiles proposer on proposer.id=idea.author_id;

commit;
