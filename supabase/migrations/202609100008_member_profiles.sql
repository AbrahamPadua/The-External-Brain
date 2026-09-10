-- 202609100008 member profiles: signup details and self-service editing.
--
-- Members sign up with a name and, optionally, a major and a line about their
-- research interests. This migration
--   * stores the two new fields next to the existing profiles.display_name,
--   * teaches the auth.users trigger to carry all three across confirmation of
--     the magic link, and
--   * adds one self-only RPC, update_my_profile, so the details can be corrected
--     after signing in.
--
-- What this file deliberately does NOT change:
--   * account_status stays 'pending' on signup - approval still runs through
--     decide_account (Operations/Research) and roles through the Operations
--     role RPCs. raw_user_meta_data is user-controlled, so the trigger copies
--     only the three display fields out of it and never a status or a role.
--   * the sign-in email lives in auth.users and is not writable from here.
--   * profiles remains RPC-only for writes: 202609090003 dropped the self
--     update policy and 202609090004 revoked insert/update/delete on every
--     public table from anon and authenticated. update_my_profile is the only
--     way in, it takes no target-user argument, and it writes exactly the row
--     identified by auth.uid().
--
-- Existing accounts stay usable: both columns default to '' and the length
-- checks are added NOT VALID, so rows written before this migration are never
-- rejected retroactively. A name is required of the row update_my_profile
-- writes, not of the table, so a legacy profile with an empty display_name
-- keeps working until its owner fills the form in.
--
-- Visibility is unchanged and follows display_name: profiles_visibility
-- (202609090003) shows a profile row to its owner, to Operations/Research, and
-- to approved members when the profile itself is approved. Major and interests
-- are therefore directory information for approved members, not private notes.
--
-- This migration is not yet applied to any project.

alter table public.profiles
  add column if not exists major text not null default '',
  add column if not exists interests text not null default '';

alter table public.profiles
  add constraint profiles_display_name_length check (char_length(display_name) <= 80) not valid;
alter table public.profiles
  add constraint profiles_major_length check (char_length(major) <= 80) not valid;
alter table public.profiles
  add constraint profiles_interests_length check (char_length(interests) <= 280) not valid;

-- One shared normaliser so the trigger and the RPC cannot drift: collapse every
-- run of whitespace or control character into a single space and trim. Names
-- pasted out of a form keep their internal spacing and lose newlines/tabs that
-- would otherwise break a single-line field.
create or replace function public.normalize_profile_text(p_value text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]\s]+', ' ', 'g'))
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  -- Signup details ride along in the magic-link metadata and land here when the
  -- auth user is first created, so they survive the confirmation round trip.
  -- Truncation keeps a hostile or oversized payload from blocking the signup;
  -- account_status is left at its 'pending' default.
  insert into public.profiles(id, display_name, major, interests)
  values (
    new.id,
    left(public.normalize_profile_text(m->>'display_name'), 80),
    left(public.normalize_profile_text(m->>'major'), 80),
    left(public.normalize_profile_text(m->>'interests'), 280)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Self-service profile edit. Available to any signed-in account, including one
-- that is still pending, because a pending member has to be able to fix the
-- name their reviewer is about to read. p_major / p_interests are null to leave
-- a field as it is and '' to clear it.
create or replace function public.update_my_profile(
  p_display_name text,
  p_major text default null,
  p_interests text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_major text;
  v_interests text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_name := public.normalize_profile_text(p_display_name);
  if char_length(v_name) < 2 then
    raise exception 'a name of at least 2 characters is required' using errcode = '22023';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'name must be 80 characters or fewer' using errcode = '22023';
  end if;
  v_major := case when p_major is null then null else public.normalize_profile_text(p_major) end;
  if char_length(coalesce(v_major, '')) > 80 then
    raise exception 'major must be 80 characters or fewer' using errcode = '22023';
  end if;
  v_interests := case when p_interests is null then null else public.normalize_profile_text(p_interests) end;
  if char_length(coalesce(v_interests, '')) > 280 then
    raise exception 'interests must be 280 characters or fewer' using errcode = '22023';
  end if;

  update public.profiles set
    display_name = v_name,
    major = coalesce(v_major, major),
    interests = coalesce(v_interests, interests),
    updated_at = now()
  where id = v_uid;
  if not found then
    raise exception 'profile not found' using errcode = '42501';
  end if;
  -- Field names only: the audit trail records that a member edited their own
  -- profile, not the contents of the fields.
  perform public.audit('profile_updated', 'profile', v_uid, jsonb_build_object(
    'major_set', v_major is not null,
    'interests_set', v_interests is not null
  ));
end $$;

revoke all on function public.normalize_profile_text(text) from public, anon;
revoke all on function public.update_my_profile(text, text, text) from public, anon;
grant execute on function public.normalize_profile_text(text) to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
