-- Promote the current overview to the canonical plain-text abstract, once.
-- Original content is retained privately on each initiative for recovery.
begin;
create or replace function public.clean_initiative_text(value text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(
    coalesce(value, ''), 'â€”', '—'), 'â€“', '–'), 'â€™', '’'), 'â€˜', '‘'),
    'â€œ', '“'), 'â€' || chr(157), '”'), 'â€', '”'), 'Â' || chr(160), ' ')
$$;

create or replace function public.initiative_overview_text(value text)
returns text language plpgsql immutable set search_path = public as $$
declare
  result text := coalesce(value, '');
  entity text[];
  codepoint integer;
begin
  result := regexp_replace(result, '<(script|style)[^>]*>.*?</\1>', '', 'gis');
  result := regexp_replace(result, '<br\s*/?>', E'\n', 'gi');
  result := regexp_replace(result, '</(p|div|h[1-6]|li|blockquote|tr)\s*>', E'\n\n', 'gi');
  result := regexp_replace(result, '<[^>]*>', '', 'g');
  -- Decode entities only after removing markup so encoded text remains text.
  for entity in select regexp_matches(result, '&#(x[0-9a-f]+|[0-9]+);', 'gi') loop
    begin
      if lower(left(entity[1], 1)) = 'x' then
        codepoint := ('x' || lpad(substring(entity[1] from 2), 8, '0'))::bit(32)::integer;
      else codepoint := entity[1]::integer;
      end if;
      if codepoint between 1 and 1114111 and codepoint not between 55296 and 57343 then
        result := replace(result, '&#' || entity[1] || ';', chr(codepoint));
      end if;
    exception when others then null; -- Leave malformed entities intact.
    end;
  end loop;
  result := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    result, '&nbsp;', ' '), '&quot;', '"'), '&apos;', ''''), '&ldquo;', '“'), '&rdquo;', '”'),
    '&lsquo;', '‘'), '&rsquo;', '’'), '&mdash;', '—'), '&ndash;', '–'), '&hellip;', '…');
  result := replace(replace(replace(result, '&lt;', '<'), '&gt;', '>'), '&amp;', '&');
  result := replace(result, chr(160), ' ');
  result := regexp_replace(result, E'\n[\t ]+', E'\n', 'g');
  result := regexp_replace(result, E'\n{3,}', E'\n\n', 'g');
  return public.clean_initiative_text(btrim(result, E' \n\r\t'));
end $$;

do $$
declare i public.initiatives%rowtype; new_abstract text;
begin
  for i in select * from public.initiatives
    where not (coalesce(content, '{}'::jsonb) ? 'abstract_from_overview') for update loop
    new_abstract := public.initiative_overview_text(i.content->>'html');
    if new_abstract = '' then new_abstract := public.clean_initiative_text(i.summary); end if;
    update public.initiatives set summary = new_abstract,
      content = coalesce(i.content, '{}'::jsonb) || jsonb_build_object(
        'abstract_promotion_backup', jsonb_build_object('summary', i.summary,
          'html', i.content->>'html', 'motivation', i.content->>'motivation'),
        'html', '', 'motivation', public.clean_initiative_text(i.content->>'motivation'),
        'abstract_from_overview', true), updated_at = now()
    where id = i.id;
  end loop;
end $$;

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
          'category', v_category, 'motivation', v_motivation, 'html', '', 'abstract_from_overview', true),
        updated_at = now()
    where id = p_initiative;
  perform public.audit('initiative_details_updated', 'initiative', p_initiative,
    jsonb_build_object('title', v_title, 'category', v_category));
end $$;

revoke all on function public.update_initiative_details(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_initiative_details(uuid,text,text,text,text,text)
  to authenticated;

commit;
