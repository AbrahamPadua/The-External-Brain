-- Public catalog parity. Apply after 023.
--
-- Signed-out visitors see the catalog the way a signed-in account does, except
-- an initiative's Progress, Tasks and Activity (documents, obligations, tasks
-- and audit events stay approved-only). Compared with 023 the public view now:
--   * lists initiatives of every status, not only active ones;
--   * carries HP;
--   * carries the team roster (account id, display name, lead flag) and the
--     lead's account id, so the Team tab can name people.
-- Profiles themselves stay approved-only; only the display name of someone on
-- a team is published, never email, major, interests or roles.
begin;

-- The same balance hp_balance() returns, without its approved-account check.
-- HP is part of the public catalog, and Postgres checks a view's function calls
-- against the caller, so signed-out visitors need EXECUTE on it.
create or replace function public.initiative_hp(p_initiative uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare balance int; maximum int; ev record;
begin
  select starting_hp, max_hp into balance, maximum from system_policy;
  for ev in
    select e.points from hp_events e
    where e.initiative_id = p_initiative and e.kind <> 'reversal'
      and not exists (select 1 from hp_events r where r.reversed_event_id = e.id)
    order by e.sequence
  loop
    balance := greatest(0, least(maximum, balance + ev.points));
  end loop;
  return balance;
end $$;
revoke all on function public.initiative_hp(uuid) from public;
grant execute on function public.initiative_hp(uuid) to anon, authenticated;

create or replace view public.initiative_catalog as
  select i.id, i.title, i.summary, i.status, i.lead_name,
    coalesce(i.content->>'category', '') as category,
    coalesce(i.content->>'html', '') as overview_html,
    coalesce(i.content->>'abstract_html', '') as abstract_html,
    coalesce(i.content->>'motivation', '') as motivation,
    coalesce(i.content->>'motivation_html', '') as motivation_html,
    i.cover_object_path, i.cover_fallback_color, i.cover_position_x, i.cover_position_y,
    coalesce(nullif(btrim(i.lead_name), ''), lead.display_name, '') as lead_display_name,
    (select count(*) from public.initiative_memberships m
      where m.initiative_id = i.id and m.left_at is null)::integer as member_count,
    i.lead_id,
    public.initiative_hp(i.id) as hp,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by m.joined_at)
      from public.initiative_memberships m join public.profiles p on p.id = m.user_id
      where m.initiative_id = i.id and m.left_at is null
    ), '[]'::jsonb) as members
  from public.initiatives i
  left join public.profiles lead on lead.id = i.lead_id;

-- Covers and inline abstract/motivation images of every listed initiative.
create or replace function public.is_public_initiative_cover(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from initiatives where cover_object_path is not null and cover_object_path = p_name
  )
$$;

create or replace function public.is_public_initiative_content_image(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from initiatives i
    where i.id::text = split_part(p_name, '/', 1)
      and position(p_name in coalesce(i.content->>'abstract_html', '') || ' '
        || coalesce(i.content->>'motivation_html', '')) > 0
  )
$$;

commit;
