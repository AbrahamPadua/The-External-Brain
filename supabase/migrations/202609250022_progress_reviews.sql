-- Any approved member may review a submitted RM. Voluntary reviews carry no
-- obligation, deadline or HP. Assigned reviews retain their existing workflow.
begin;
alter table public.documents add column is_voluntary_review boolean not null default false;
alter table public.documents drop constraint documents_historical_import_shape;
alter table public.documents add constraint documents_historical_import_shape check (
  (is_historical_import and not is_voluntary_review and obligation_id is null and author_id is null
    and historical_source_key is not null and btrim(historical_source_key) <> '')
  or (not is_historical_import and author_id is not null and historical_source_key is null and (
    (not is_voluntary_review and (obligation_id is not null or (kind='rm' and submitted_version_number is null and target_monday is not null)))
    or (is_voluntary_review and kind='review' and obligation_id is null and reviewed_document_id is not null and reviewed_version_number is not null)
  ))
);
create unique index voluntary_review_author_target_version on public.documents(author_id,reviewed_document_id,reviewed_version_number)
  where is_voluntary_review;

create or replace function public.can_edit_document(did uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_approved() and exists (
    select 1 from documents d left join obligations o on o.id=d.obligation_id
    where d.id=did and not d.is_historical_import and (
      (d.kind='rm' and public.is_member(d.initiative_id))
      or (d.kind='review' and o.responsible_user_id=auth.uid())
      or (d.is_voluntary_review and d.author_id=auth.uid())
    )
  )
$$;

create function public.start_rm_review(p_target uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare target documents%rowtype; assignment obligations%rowtype; did uuid; pinned integer; body jsonb;
begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  -- Serialize repeated clicks against the same target, including concurrent ones.
  select * into target from documents where id=p_target for update;
  if not found or target.kind<>'rm' or target.submitted_version_number is null
    or exists(select 1 from document_drafts where document_id=p_target) then
    raise exception 'submit the RM before reviewing it';
  end if;
  select version_number,content into pinned,body from document_versions where document_id=p_target order by version_number desc limit 1;
  if pinned is null then raise exception 'RM version unavailable'; end if;
  body := jsonb_build_object('blocks',jsonb_build_array(),'title',left('Review of '||coalesce(body->>'title','Roast Me'),200),
    'html','<h2>Feedback</h2><p></p><h2>Suggestions</h2><p></p>');
  select * into assignment from obligations where kind='review' and responsible_user_id=auth.uid()
    and target_document_id=p_target and status in ('open','missed') order by due_at,id limit 1 for update;
  if found then
    -- The same conflict-of-interest boundary used by assigned review submission.
    if public.is_member(target.initiative_id) or exists(select 1 from initiatives where id=target.initiative_id and lead_id=auth.uid()) then
      raise exception 'assigned reviews exclude your own initiative';
    end if;
    select id into did from documents where obligation_id=assignment.id;
    if did is not null then return did; end if;
    return public.save_document_draft(assignment.id,body,null);
  end if;
  select id into did from documents where is_voluntary_review and author_id=auth.uid()
    and reviewed_document_id=p_target and reviewed_version_number=pinned;
  if did is not null then return did; end if;
  insert into documents(kind,initiative_id,author_id,reviewed_document_id,reviewed_version_number,is_voluntary_review)
    values('review',target.initiative_id,auth.uid(),p_target,pinned,true) returning id into did;
  insert into document_drafts(document_id,content,updated_by) values(did,body,auth.uid());
  perform public.audit('voluntary_review_started','document',did,jsonb_build_object('target',p_target,'version',pinned));
  return did;
end $$;

create function public.save_voluntary_review(p_document uuid,p_content jsonb,p_revision integer default null,p_submit boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare d documents%rowtype; rev integer; next_version integer;
begin
  if not public.is_approved() then raise exception 'approved account required'; end if;
  select * into d from documents where id=p_document for update;
  if not found or not d.is_voluntary_review or d.author_id<>auth.uid() then raise exception 'review author required'; end if;
  if coalesce(jsonb_typeof(p_content),'')<>'object' or coalesce(jsonb_typeof(p_content->'blocks'),'')<>'array'
    or length(p_content::text)>150000 then raise exception 'invalid review content'; end if;
  select revision into rev from document_drafts where document_id=d.id;
  if p_revision is distinct from rev then raise exception 'draft conflict: reload before saving'; end if;
  if p_submit then
    if rev is null then return d.id; end if; -- repeat submission cannot add another version
    select coalesce(max(version_number),0)+1 into next_version from document_versions where document_id=d.id;
    insert into document_versions(document_id,version_number,content,created_by,submitted_at)
      values(d.id,next_version,p_content,auth.uid(),now());
    update documents set submitted_version_number=next_version where id=d.id;
    delete from document_drafts where document_id=d.id;
    perform public.audit('voluntary_review_submitted','document',d.id,jsonb_build_object('version',next_version,'target',d.reviewed_document_id));
  else
    insert into document_drafts(document_id,content,updated_by) values(d.id,p_content,auth.uid())
    on conflict(document_id) do update set content=excluded.content,revision=document_drafts.revision+1,updated_by=auth.uid(),updated_at=now();
  end if;
  return d.id;
end $$;
revoke all on function public.start_rm_review(uuid),public.save_voluntary_review(uuid,jsonb,integer,boolean) from public,anon;
grant execute on function public.start_rm_review(uuid),public.save_voluntary_review(uuid,jsonb,integer,boolean) to authenticated;
commit;
