-- One-off data fix: remove three initiatives and everything that belongs to them.
--   * EEG Controlled Humanoid Robot   (stopped duplicate of "EEG-Controlled Humanoid Robot")
--   * EEG Fundamentals: A Workshop Series (stopped)
--   * A new better Proposal           (test initiative, and the proposal that created it)
--
-- Run once in the Supabase SQL Editor. Everything runs in a single transaction and
-- aborts without changing anything if:
--   * the titles do not match exactly these three initiatives, or
--   * another initiative still points at one of their documents (a review of their
--     Roast Me, or a review obligation targeting it).
--
-- History tables (hp_events, document_versions) are normally immutable; their
-- guard triggers are switched off only inside this transaction and switched back
-- on before it commits. audit_events is never deleted; a removal entry is added.
-- Storage files cannot be removed from SQL: the last query lists any files left in
-- folders named after the removed initiatives so they can be deleted in the
-- dashboard (Storage) afterwards.

begin;

create temp table doomed_initiatives as
select id, title, status, proposal_id
from public.initiatives
where (lower(btrim(title)) = lower('EEG Controlled Humanoid Robot') and status = 'stopped')
   or (lower(btrim(title)) = lower('EEG Fundamentals: A Workshop Series') and status = 'stopped')
   or (lower(btrim(title)) = lower('A new better Proposal'));

create temp table doomed_obligations as
select o.id from public.obligations o join doomed_initiatives d on d.id = o.initiative_id;

create temp table doomed_documents as
select doc.id from public.documents doc
where doc.initiative_id in (select id from doomed_initiatives)
   or doc.obligation_id in (select id from doomed_obligations);

do $$
declare
  matched int;
  outside_reviews int;
  outside_targets int;
  outside_hp int;
begin
  select count(*) into matched from doomed_initiatives;
  if matched <> 3 then
    raise exception 'Expected exactly 3 initiatives to remove, matched %: %', matched,
      (select coalesce(string_agg(title || ' (' || status || ')', ', '), 'none') from doomed_initiatives);
  end if;

  select count(*) into outside_reviews from public.documents doc
  where doc.reviewed_document_id in (select id from doomed_documents)
    and doc.id not in (select id from doomed_documents);
  select count(*) into outside_targets from public.obligations o
  where o.target_document_id in (select id from doomed_documents)
    and o.id not in (select id from doomed_obligations);
  select count(*) into outside_hp from public.hp_events h
  where h.obligation_id in (select id from doomed_obligations)
    and h.initiative_id not in (select id from doomed_initiatives);
  if outside_reviews + outside_targets + outside_hp > 0 then
    raise exception 'Other initiatives still reference these initiatives (reviews: %, review obligations: %, HP events: %). Nothing was removed.',
      outside_reviews, outside_targets, outside_hp;
  end if;
end $$;

-- Record the removal before the rows go (audit_events has no foreign keys).
insert into public.audit_events(actor_id, action, entity_type, entity_id, detail)
select null, 'initiative_removed', 'initiative', id,
       jsonb_build_object('title', title, 'status', status, 'reason', 'duplicate/test cleanup 2026-09-26')
from doomed_initiatives;

-- Notifications that link to a removed initiative or one of its documents.
delete from public.notifications n
where exists (select 1 from doomed_initiatives d where n.payload::text like '%' || d.id::text || '%')
   or exists (select 1 from doomed_documents d where n.payload::text like '%' || d.id::text || '%');

alter table public.hp_events disable trigger immutable_hp;
alter table public.document_versions disable trigger immutable_versions;

delete from public.hp_events where initiative_id in (select id from doomed_initiatives);
-- Detach review obligations from the documents about to go, then remove every
-- document in one statement so reviews and the RMs they review leave together.
-- Cascades to versions, drafts, comment threads, comments and attachments.
update public.obligations set target_document_id = null
where id in (select id from doomed_obligations) and target_document_id is not null;
delete from public.documents where id in (select id from doomed_documents);
delete from public.obligations where id in (select id from doomed_obligations);
-- Cascades to memberships, join requests, tasks and task attachments.
delete from public.initiatives where id in (select id from doomed_initiatives);
delete from public.proposals where id in (select proposal_id from doomed_initiatives where proposal_id is not null);

alter table public.hp_events enable trigger immutable_hp;
alter table public.document_versions enable trigger immutable_versions;

commit;

-- Leftover files to delete from Storage in the dashboard (empty result = nothing to do).
select bucket_id, name
from storage.objects
where (storage.foldername(name))[1] in (select id::text from doomed_initiatives)
order by bucket_id, name;
