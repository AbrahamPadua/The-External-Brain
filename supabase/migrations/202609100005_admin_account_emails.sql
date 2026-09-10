-- Email addresses are available only to currently approved account reviewers.
create or replace function public.admin_account_emails()
returns table(user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_role('operations') or public.has_role('research')) then
    raise exception 'account administrator required' using errcode = '42501';
  end if;
  return query select p.id, u.email::text
    from public.profiles p join auth.users u on u.id = p.id;
end;
$$;
revoke all on function public.admin_account_emails() from public, anon;
grant execute on function public.admin_account_emails() to authenticated;
