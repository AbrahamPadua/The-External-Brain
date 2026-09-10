-- 202609100007 storage privacy: narrow initiative-images reads.
--
-- 202609090004 widened this bucket's SELECT policy to every approved account.
-- Restore a per-initiative audience that mirrors who may read the drafts these
-- images are embedded in:
--   * a current participant of the initiative that owns the object's folder, or
--   * an account holding a live review obligation ('open'/'submitted') whose
--     assigned RM belongs to that initiative.
-- The folder's first path segment is the initiative id, matched as text
-- (initiative_id::text = segment) exactly as the existing insert/delete policies
-- do; the path is never cast to uuid, so a malformed object name cannot raise.
-- Operations/Research get no blanket image or draft access from this change, and
-- the document_drafts policy is left untouched.
--
-- Known limitation: objects carry no link to a specific document or version, so
-- inline images on a *submitted* RM stay invisible to approved members outside the
-- owning initiative until an explicit attachment link exists. This migration is
-- not yet applied to any project.

drop policy if exists initiative_images_read on storage.objects;
create policy initiative_images_read on storage.objects for select using (
  bucket_id = 'initiative-images'
  and public.is_approved()
  and (
    exists (
      select 1 from public.initiative_memberships m
      where m.initiative_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.left_at is null
    )
    or exists (
      select 1 from public.obligations o
      join public.documents d on d.id = o.target_document_id
      where o.kind = 'review'
        and o.responsible_user_id = auth.uid()
        and o.status in ('open', 'submitted')
        and d.initiative_id::text = (storage.foldername(name))[1]
    )
  )
);
