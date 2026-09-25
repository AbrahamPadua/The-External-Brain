-- Allow an assigned lead or Research/Admin to continue an initiative.
-- Public visitors see the source lead name, but no account or working content.
create or replace view public.initiative_catalog as
  select id, title, summary, status, lead_name
  from public.initiatives where status = 'active';

create function public.update_initiative_details(
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
  v_summary text := btrim(coalesce(p_summary, ''));
  v_category text := btrim(coalesce(p_category, ''));
  v_motivation text := btrim(coalesce(p_motivation, ''));
  v_html text := btrim(coalesce(p_html, ''));
begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  select * into i from public.initiatives where id = p_initiative for update;
  if not found then raise exception 'unknown initiative'; end if;
  if not (coalesce(i.lead_id = auth.uid(), false) or public.has_role('research')) then
    raise exception 'initiative lead or Research/Admin required';
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 200 then
    raise exception 'title must be 3 to 200 characters';
  end if;
  if char_length(v_summary) < 20 or char_length(v_summary) > 2000 then
    raise exception 'abstract must be 20 to 2000 characters';
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
        content = coalesce(i.content, '{}'::jsonb) || jsonb_build_object(
          'category', v_category, 'motivation', v_motivation, 'html', v_html),
        updated_at = now()
    where id = p_initiative;
  perform public.audit('initiative_details_updated', 'initiative', p_initiative,
    jsonb_build_object('title', v_title, 'category', v_category));
end $$;

revoke all on function public.update_initiative_details(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_initiative_details(uuid,text,text,text,text,text)
  to authenticated;

-- Keep ordinary submitted RM revisions Research-only. Imported source RMs may
-- also be revised by their assigned lead; version 1 and its review links stay put.
create or replace function public.revise_rm(
  p_document uuid,
  p_content jsonb,
  p_reason text,
  p_author uuid default null,
  p_source_author text default null,
  p_expected_version integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.documents%rowtype;
  v1 public.document_versions%rowtype;
  v_current_author text;
  v_next integer;
  v_content jsonb;
begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'a revision reason is required';
  end if;
  if coalesce(jsonb_typeof(p_content), '') <> 'object'
    or coalesce(jsonb_typeof(p_content->'blocks'), '') <> 'array' then
    raise exception 'content must be an object with a blocks array';
  end if;

  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'unknown document'; end if;
  if d.kind <> 'rm' then raise exception 'only reporting memos can be revised here'; end if;
  if d.is_historical_import then
    if not (public.has_role('research') or exists (
      select 1 from public.initiatives i where i.id = d.initiative_id and i.lead_id = auth.uid()
    )) then raise exception 'initiative lead or Research/Admin required'; end if;
  elsif not public.has_role('research') then
    raise exception 'research required';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
    from public.document_versions where document_id = d.id;
  if p_expected_version is distinct from v_next - 1 then
    raise exception 'revision conflict: reload the latest version before revising';
  end if;

  if d.is_historical_import then
    if p_author is not null then
      raise exception 'historical memos keep a null account author; use p_source_author';
    end if;
    select * into v1 from public.document_versions where document_id = d.id and version_number = 1;
    if not found then raise exception 'historical memo has no original version'; end if;
    select content->>'source_author' into v_current_author
      from public.document_versions where document_id = d.id and version_number = v_next - 1;
    if not public.has_role('research') and p_source_author is not null
       and p_source_author is distinct from v_current_author then
      raise exception 'source author attribution cannot be changed by the initiative lead';
    end if;
    v_content := v1.content || jsonb_build_object(
      'blocks', p_content->'blocks',
      'html', coalesce(p_content->'html', v1.content->'html', to_jsonb(''::text)),
      'title', coalesce(p_content->'title', v1.content->'title'),
      'source_author', to_jsonb(coalesce(p_source_author, v_current_author)),
      'revision_of', to_jsonb(1),
      'revised_by', to_jsonb(auth.uid()::text),
      'revised_at', to_jsonb(now()::text),
      'revision_reason', to_jsonb(btrim(p_reason))
    );
    perform set_config('openlabs.rm_revision', '1', true);
    insert into public.document_versions(document_id, version_number, content, submitted_at, created_by)
      values (d.id, v_next, v_content, now(), auth.uid());
    perform set_config('openlabs.rm_revision', '0', true);
  else
    if p_source_author is not null then
      raise exception 'p_source_author applies only to historical memos';
    end if;
    if d.submitted_version_number is null then
      raise exception 'only a submitted memo can be revised';
    end if;
    if p_author is not null and not public.is_approved(p_author) then
      raise exception 'the new author must be an approved account';
    end if;
    v_content := p_content || jsonb_build_object(
      'revised_by', to_jsonb(auth.uid()::text),
      'revised_at', to_jsonb(now()::text),
      'revision_reason', to_jsonb(btrim(p_reason))
    );
    insert into public.document_versions(document_id, version_number, content, submitted_at, created_by)
      values (d.id, v_next, v_content, now(), auth.uid());
    update public.documents
      set submitted_version_number = v_next,
          author_id = coalesce(p_author, author_id)
      where id = d.id;
  end if;

  perform public.audit('rm_revised', 'document', d.id, jsonb_build_object(
    'version', v_next,
    'historical', d.is_historical_import,
    'author_changed', p_author is not null,
    'source_author_changed', p_source_author is not null and p_source_author is distinct from v_current_author,
    'reason', btrim(p_reason)
  ));
  return d.id;
end $$;
