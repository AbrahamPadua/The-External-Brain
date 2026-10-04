-- New approvals retain the submitted abstract and store the plain-text plan separately.
-- Existing records remain untouched. Public view adds only a final column.
begin;

create or replace function public.decide_proposal(p_proposal uuid,p_status public.proposal_status,p_reason text default null) returns uuid language plpgsql security definer set search_path=public as $$ declare p proposals%rowtype; i uuid; begin
 if not public.has_role('research') then raise exception 'research required'; end if;
 if p_status not in ('approved','rejected','changes_requested') then raise exception 'invalid decision'; end if;
 select * into p from proposals where id=p_proposal for update; if not found then raise exception 'unknown proposal'; end if;
 if p.status='approved' and p_status='approved' then select id into i from initiatives where proposal_id=p.id; return i; end if;
 if p.status<>'submitted' then raise exception 'proposal not submitted'; end if;
 if p_status='approved' and not public.is_approved(p.author_id) then raise exception 'author not approved'; end if;
 if p_status='approved' and public.count_words(p.content->>'motivation') < 150 then
   raise exception 'motivation must be at least 150 words before approval (currently %)', public.count_words(p.content->>'motivation');
 end if;
 update proposals set status=p_status,decision_reason=p_reason,decided_by=auth.uid(),decided_at=now() where id=p.id;
 if p_status='approved' then insert into initiatives(proposal_id,title,summary,content,lead_id) values(p.id,p.title,p.summary,coalesce(p.content,'{}'::jsonb) || jsonb_build_object('execution_plan',coalesce(p.content->>'html',''),'html','','abstract_from_overview',true),p.author_id) returning id into i; insert into initiative_memberships(initiative_id,user_id,role) values(i,p.author_id,'lead'); end if;
 insert into notifications(user_id,kind,payload) values(p.author_id,'proposal_decided',jsonb_build_object('status',p_status));
 perform audit('proposal_decided','proposal',p.id,jsonb_build_object('status',p_status,'reason',p_reason)); return i; end $$;

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
      where m.initiative_id = i.id and m.left_at is null)::integer as member_count,
    i.lead_id,
    public.initiative_hp(i.id) as hp,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by m.joined_at)
      from public.initiative_memberships m join public.profiles p on p.id = m.user_id
      where m.initiative_id = i.id and m.left_at is null
    ), '[]'::jsonb) as members,
    coalesce(i.content->>'execution_plan', '') as execution_plan
  from public.initiatives i
  left join public.profiles lead on lead.id = i.lead_id;

commit;
