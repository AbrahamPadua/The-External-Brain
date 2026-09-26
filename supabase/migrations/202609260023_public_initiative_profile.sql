-- Public initiative profile. Apply after 022.
--
-- Signed-out visitors (and accounts still awaiting approval) read the catalog
-- through public.initiative_catalog. Until now it carried only title, summary,
-- status and a free-text lead name. It now carries the rest of an active
-- initiative's public profile: category, overview/abstract/motivation bodies,
-- cover image and colour, the lead's display name and the team size.
--
-- Covers and inline abstract/motivation images live in private buckets. Two
-- read policies let anyone fetch exactly the files an ACTIVE initiative's public
-- profile uses: its current cover, and inline images its abstract or motivation
-- actually references. Draft uploads, stopped/completed initiatives, RM and task
-- images are unaffected.
--
-- Deliberately not public: team member names (profiles stay approved-only),
-- HP, tasks, obligations, documents and activity.
begin;

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
      where m.initiative_id = i.id and m.left_at is null)::integer as member_count
  from public.initiatives i
  left join public.profiles lead on lead.id = i.lead_id
  where i.status = 'active';

create or replace function public.is_public_initiative_cover(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from initiatives
    where status = 'active' and cover_object_path is not null and cover_object_path = p_name
  )
$$;

create or replace function public.is_public_initiative_content_image(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from initiatives i
    where i.status = 'active'
      and i.id::text = split_part(p_name, '/', 1)
      and position(p_name in coalesce(i.content->>'abstract_html', '') || ' '
        || coalesce(i.content->>'motivation_html', '')) > 0
  )
$$;

revoke all on function public.is_public_initiative_cover(text) from public;
revoke all on function public.is_public_initiative_content_image(text) from public;
grant execute on function public.is_public_initiative_cover(text) to anon, authenticated;
grant execute on function public.is_public_initiative_content_image(text) to anon, authenticated;

-- The older approved-only read policies apply to every role and look up
-- initiative/membership tables directly. For a signed-out request those lookups
-- fail with "permission denied" before the public policies below are consulted,
-- so scope them to signed-in accounts. They already require an approved
-- account, so nobody's access changes.
alter policy initiative_covers_read on storage.objects to authenticated;
alter policy initiative_content_images_read on storage.objects to authenticated;
alter policy initiative_images_read on storage.objects to authenticated;

drop policy if exists initiative_covers_public_read on storage.objects;
create policy initiative_covers_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'initiative-covers' and public.is_public_initiative_cover(name));

drop policy if exists initiative_content_images_public_read on storage.objects;
create policy initiative_content_images_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'initiative-content-images' and public.is_public_initiative_content_image(name));

commit;
