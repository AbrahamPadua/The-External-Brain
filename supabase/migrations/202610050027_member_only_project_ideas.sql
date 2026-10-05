-- Apply before the member-only project-ideas frontend.
begin;

-- Keep an owner projection so approved members can browse other members' ideas
-- without widening the private proposal/feedback policies. The explicit gate
-- also denies pending, rejected and suspended authenticated accounts.
create or replace view public.project_idea_catalog with (security_barrier=true) as
  select p.id,p.title,p.summary,coalesce(p.content->>'category','Research') as category,
    coalesce(p.content->>'html','') as execution_plan,coalesce(p.content->>'motivation','') as motivation,
    p.author_id as proposer_id,pr.display_name as proposer_name,i.id as initiative_id
  from public.proposals p join public.profiles pr on pr.id=p.author_id
  left join public.initiatives i on i.proposal_id=p.id
  where public.is_approved() and p.purpose='project_idea' and p.status='approved';
revoke all on public.project_idea_catalog from public,anon,authenticated;
grant select on public.project_idea_catalog to authenticated;

-- Initiatives stay public and retain proposer credit. Only current members
-- receive the reference used to open the original project idea.
create or replace view public.initiative_catalog as
  select i.id, i.title, i.summary, i.status, i.lead_name,
    coalesce(i.content->>'category', '') as category,
    coalesce(i.content->>'html', '') as overview_html,
    coalesce(i.content->>'abstract_html', '') as abstract_html,
    coalesce(i.content->>'motivation', '') as motivation,
    coalesce(i.content->>'motivation_html', '') as motivation_html,
    i.cover_object_path, i.cover_fallback_color, i.cover_position_x, i.cover_position_y,
    coalesce(nullif(btrim(i.lead_name), ''), lead.display_name, '') as lead_display_name,
    (select count(*) from public.initiative_memberships m where m.initiative_id = i.id and m.left_at is null)::integer as member_count,
    i.lead_id, public.initiative_hp(i.id) as hp,
    coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.display_name) order by m.joined_at)
      from public.initiative_memberships m join public.profiles pr on pr.id = m.user_id
      where m.initiative_id = i.id and m.left_at is null), '[]'::jsonb) as members,
    coalesce(i.content->>'execution_plan', '') as execution_plan,
    case when public.is_approved() then idea.id else null end as project_idea_id,
    idea.author_id as proposer_id,proposer.display_name as proposer_name
  from public.initiatives i left join public.profiles lead on lead.id=i.lead_id
  left join public.proposals idea on idea.id=i.proposal_id and idea.purpose='project_idea' and idea.status='approved'
  left join public.profiles proposer on proposer.id=idea.author_id;

notify pgrst, 'reload schema';
commit;
