-- Rich initiative tasks. Migrations 001-012 are already applied and immutable;
-- 013 remains ordered immediately before this migration.

-- Drop the legacy vocabulary before translating rows: while the old
-- open/done/cancelled CHECK is active it correctly rejects pending/finished.
alter table public.tasks drop constraint if exists tasks_status_check;

update public.tasks set status = case status
  when 'done' then 'finished'
  when 'open' then 'pending'
  when 'cancelled' then 'planned'
  else status end;

alter table public.tasks add constraint tasks_status_check
  check (status in ('planned', 'pending', 'finished'));
alter table public.tasks add constraint tasks_title_length
  check (char_length(btrim(title)) between 1 and 160) not valid;
alter table public.tasks validate constraint tasks_title_length;
alter table public.tasks add constraint tasks_details_length
  check (char_length(details) <= 2000) not valid;
alter table public.tasks validate constraint tasks_details_length;

drop function if exists public.create_task(uuid, text, text, uuid, timestamptz);
create function public.create_task(
  p_initiative uuid,
  p_title text,
  p_details text default '',
  p_assignee uuid default null,
  p_due_at timestamptz default null,
  p_status text default 'planned'
) returns uuid language plpgsql security definer set search_path=public as $$
declare tid uuid; begin
  if not public.is_approved() or not (public.is_admin() or exists (
    select 1 from initiatives where id=p_initiative and lead_id=auth.uid()
  )) then raise exception 'lead or admin required'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 160 then raise exception 'title must be 1 to 160 characters'; end if;
  if char_length(coalesce(p_details,'')) > 2000 then raise exception 'description must be at most 2000 characters'; end if;
  if p_status not in ('planned','pending','finished') then raise exception 'invalid task status'; end if;
  if p_assignee is not null and not exists (
    select 1 from initiative_memberships m join profiles p on p.id=m.user_id
    where m.initiative_id=p_initiative and m.user_id=p_assignee and m.left_at is null
      and p.account_status='approved'
  ) then raise exception 'assignee must be an approved initiative member'; end if;
  insert into tasks(initiative_id,title,details,status,assignee_id,due_at,created_by)
    values(p_initiative,btrim(p_title),coalesce(p_details,''),p_status,p_assignee,p_due_at,auth.uid())
    returning id into tid;
  perform public.audit('task_created','task',tid,jsonb_build_object('initiative',p_initiative,'status',p_status));
  return tid;
end $$;

create or replace function public.update_task_status(p_task uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare t tasks%rowtype; begin
  if not public.is_approved() then raise exception 'approval required'; end if;
  if p_status not in ('planned','pending','finished') then raise exception 'invalid task status'; end if;
  select * into t from tasks where id=p_task for update;
  if not found then raise exception 'unknown task'; end if;
  if not (public.is_admin() or t.assignee_id=auth.uid() or exists (
    select 1 from initiatives where id=t.initiative_id and lead_id=auth.uid()
  )) then raise exception 'task authority required'; end if;
  update tasks set status=p_status,updated_at=now() where id=p_task;
  perform public.audit('task_updated','task',p_task,jsonb_build_object('status',p_status));
end $$;

create function public.delete_task(p_task uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t tasks%rowtype; begin
  if not public.is_approved() then raise exception 'approval required'; end if;
  select * into t from tasks where id=p_task for update;
  if not found then raise exception 'unknown task'; end if;
  if not (public.is_admin() or exists (
    select 1 from initiatives where id=t.initiative_id and lead_id=auth.uid()
  )) then raise exception 'lead or admin required'; end if;
  delete from tasks where id=p_task;
  perform public.audit('task_deleted','task',p_task,
    jsonb_build_object('initiative',t.initiative_id,'title',t.title));
end $$;

revoke all on function public.create_task(uuid,text,text,uuid,timestamptz,text),
  public.update_task_status(uuid,text), public.delete_task(uuid) from public, anon;
grant execute on function public.create_task(uuid,text,text,uuid,timestamptz,text),
  public.update_task_status(uuid,text), public.delete_task(uuid) to authenticated;
