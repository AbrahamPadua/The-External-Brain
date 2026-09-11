-- Saved initiative-cover focal point. Migrations 001-015 remain immutable.

alter table public.initiatives
  add column if not exists cover_position_x smallint not null default 50,
  add column if not exists cover_position_y smallint not null default 50;

alter table public.initiatives drop constraint if exists initiatives_cover_position_bounds;
alter table public.initiatives add constraint initiatives_cover_position_bounds
  check (cover_position_x between 0 and 100 and cover_position_y between 0 and 100);

create or replace function public.set_initiative_cover_position(p_initiative uuid, p_x integer, p_y integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (
    select 1 from initiatives where id = p_initiative and lead_id = auth.uid()
  )) then
    raise exception 'initiative lead or admin required';
  end if;
  if p_x is null or p_y is null or p_x not between 0 and 100 or p_y not between 0 and 100 then
    raise exception 'cover position must be between 0 and 100';
  end if;
  update initiatives
    set cover_position_x = p_x, cover_position_y = p_y, updated_at = now()
    where id = p_initiative;
  if not found then raise exception 'unknown initiative'; end if;
  perform public.audit('initiative_cover_position', 'initiative', p_initiative,
    jsonb_build_object('x', p_x, 'y', p_y));
end $$;

revoke all on function public.set_initiative_cover_position(uuid, integer, integer) from public;
grant execute on function public.set_initiative_cover_position(uuid, integer, integer) to authenticated;
