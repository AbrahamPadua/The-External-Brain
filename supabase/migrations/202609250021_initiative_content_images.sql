-- Rich initiative content and private inline images. Apply after 020.
begin;

create or replace function public.can_edit_initiative_content(p_initiative uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from initiatives i where i.id = p_initiative and (
      i.lead_id = auth.uid() or public.is_member(i.id) or exists (
        select 1 from role_grants where user_id = auth.uid() and role = 'research' and revoked_at is null
      )
    )
  )
$$;

insert into storage.buckets(id, name, public)
values('initiative-content-images', 'initiative-content-images', false)
on conflict(id) do update set public = false;
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='storage'
    and table_name='buckets' and column_name='file_size_limit') then
    execute $sql$update storage.buckets set file_size_limit=10485760,
      allowed_mime_types=array['image/png','image/jpeg','image/gif','image/webp']
      where id='initiative-content-images'$sql$;
  end if;
end $$;

create policy initiative_content_images_read on storage.objects for select using (
  bucket_id = 'initiative-content-images' and public.is_approved()
  and exists(select 1 from public.initiatives i where i.id::text = (storage.foldername(name))[1])
);
create policy initiative_content_images_insert on storage.objects for insert with check (
  bucket_id = 'initiative-content-images' and exists (
    select 1 from public.initiatives i where i.id::text = (storage.foldername(name))[1]
      and public.can_edit_initiative_content(i.id)
  )
);
-- No UPDATE/DELETE policies: existing image bytes cannot be replaced or removed
-- by a browser upload. Removing an inline reference does not destroy its image.

-- Keep older clients from leaving a stale rich body after a plain-text edit.
create or replace function public.update_initiative_details(
  p_initiative uuid,
  p_title text,
  p_summary text,
  p_category text,
  p_motivation text,
  p_html text
) returns void language plpgsql security definer set search_path = public as $$
declare
  i public.initiatives%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_summary text := public.clean_initiative_text(btrim(coalesce(p_summary, '')));
  v_category text := btrim(coalesce(p_category, ''));
  v_motivation text := public.clean_initiative_text(btrim(coalesce(p_motivation, '')));
  v_html text := btrim(coalesce(p_html, ''));
begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  select * into i from public.initiatives where id = p_initiative for update;
  if not found then raise exception 'unknown initiative'; end if;
  if not (coalesce(i.lead_id = auth.uid(), false) or public.is_member(p_initiative) or exists (
    select 1 from public.role_grants where user_id = auth.uid() and role = 'research' and revoked_at is null
  )) then
    raise exception 'initiative member or Research required';
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 200 then
    raise exception 'title must be 3 to 200 characters';
  end if;
  if char_length(v_summary) < 20 or char_length(v_summary) > 100000 then
    raise exception 'abstract must be 20 to 100000 characters';
  end if;
  if char_length(v_category) = 0 or char_length(v_category) > 100 then
    raise exception 'category must be 1 to 100 characters';
  end if;
  if char_length(v_motivation) > 20000 then
    raise exception 'motivation must be 20000 characters or fewer';
  end if;
  if char_length(v_html) > 100000 then
    raise exception 'overview body must be 100000 characters or fewer';
  end if;

  update public.initiatives
    set title = v_title,
        summary = v_summary,
        content = coalesce(i.content, '{}'::jsonb) ||
          case when coalesce(i.content->>'html', '') <> '' and not (coalesce(i.content, '{}'::jsonb) ? 'abstract_promotion_backup')
            then jsonb_build_object('abstract_promotion_backup', jsonb_build_object('summary', i.summary, 'html', i.content->>'html', 'motivation', i.content->>'motivation'))
            else '{}'::jsonb end || jsonb_build_object(
          'category', v_category, 'motivation', v_motivation, 'html', '', 'abstract_from_overview', true, 'abstract_html', '', 'motivation_html', ''),
        updated_at = now()
    where id = p_initiative;
  perform public.audit('initiative_details_updated', 'initiative', p_initiative,
    jsonb_build_object('title', v_title, 'category', v_category));
end $$;

revoke all on function public.update_initiative_details(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_initiative_details(uuid,text,text,text,text,text)
  to authenticated;

create function public.update_initiative_content(
  p_initiative uuid, p_title text, p_category text,
  p_abstract_html text, p_motivation_html text
) returns void language plpgsql security definer set search_path = public as $$
declare
  abstract_html text := public.clean_initiative_text(coalesce(p_abstract_html, ''));
  motivation_html text := public.clean_initiative_text(coalesce(p_motivation_html, ''));
  image_ref text[];
begin
  if not public.can_edit_initiative_content(p_initiative) then
    raise exception 'initiative member or Research required';
  end if;
  if length(abstract_html) > 100000 or length(motivation_html) > 100000 then
    raise exception 'content must be 100000 characters or fewer';
  end if;
  if (abstract_html || motivation_html) ~* 'src\s*=\s*["'']\s*(data:|blob:)' then
    raise exception 'upload image files instead of storing temporary image data';
  end if;
  for image_ref in select regexp_matches(abstract_html || motivation_html,
    $re$data-object-path\s*=\s*["']([^"']+)["']$re$, 'gi') loop
    if split_part(image_ref[1], '/', 1) <> p_initiative::text or not exists (
      select 1 from storage.objects where bucket_id='initiative-content-images' and name=image_ref[1]
    ) then raise exception 'image must be uploaded to this initiative'; end if;
  end loop;
  -- The established RPC locks the row, checks membership again, validates all
  -- text fields, preserves the migration backup and records the audit event.
  perform public.update_initiative_details(p_initiative, p_title,
    public.initiative_overview_text(abstract_html), p_category,
    public.initiative_overview_text(motivation_html), '');
  update initiatives set content = content || jsonb_build_object(
    'abstract_html', abstract_html, 'motivation_html', motivation_html)
    where id = p_initiative;
end $$;
revoke all on function public.update_initiative_content(uuid,text,text,text,text) from public, anon;
grant execute on function public.update_initiative_content(uuid,text,text,text,text) to authenticated;

commit;
