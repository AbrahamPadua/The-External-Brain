-- Internal, idempotent weekly processing for pg_cron. This installs the routine
-- only; scheduling remains an explicit, separately preflighted step.
create table public.weekly_processing_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(), la_monday date not null,
  cycle_id uuid not null references public.cycles(id), cycle_created boolean not null,
  is_break boolean not null, obligations_created integer not null, penalties_created integer not null
);
alter table public.weekly_processing_runs enable row level security;

create function public.run_weekly_processing(p_now timestamptz default now())
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
   where i.status='active' and i.activated_at<(monday::timestamp at time zone 'America/Los_Angeles')
   on conflict(cycle_id,initiative_id,kind) do nothing;
  get diagnostics made_obligations=row_count;
 end if;
 select * into policy from system_policy;
 select coalesce(array_agg(x.id),'{}'::uuid[]) into due_ids from (
  select o.id from obligations o where o.status='open' and o.due_at<p_now
   and (o.kind='rm' or o.target_document_id is not null)
   and exists(select 1 from initiatives i where i.id=o.initiative_id and i.status='active')
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
revoke all on table public.weekly_processing_runs from public,anon,authenticated,service_role;
revoke all on function public.run_weekly_processing(timestamptz) from public,anon,authenticated,service_role;

-- Task detail editing needed by the modal UI. Status-only changes retain the
-- narrower assignee permission from migration 014; full edits remain lead/admin.
create function public.update_task(
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
 if char_length(coalesce(p_details,''))>2000 then raise exception 'description must be at most 2000 characters'; end if;
 if p_status not in ('planned','pending','finished') then raise exception 'invalid task status'; end if;
 if p_assignee is not null and not exists(
  select 1 from initiative_memberships m join profiles p on p.id=m.user_id
  where m.initiative_id=t.initiative_id and m.user_id=p_assignee and m.left_at is null
   and p.account_status='approved') then raise exception 'assignee must be an approved initiative member'; end if;
 update tasks set title=btrim(p_title),details=coalesce(p_details,''),assignee_id=p_assignee,
  due_at=p_due_at,status=p_status,updated_at=now() where id=p_task;
 perform public.audit('task_updated','task',p_task,jsonb_build_object('fields','details','status',p_status));
end $$;
revoke all on function public.update_task(uuid,text,text,uuid,timestamptz,text) from public,anon,service_role;
grant execute on function public.update_task(uuid,text,text,uuid,timestamptz,text) to authenticated;
