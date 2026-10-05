// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { loadLive, liveAction } from './live'
import { seed } from './model'

const mock = vi.hoisted(() => ({tables:{} as Record<string,any[]>,reads:[] as string[],rpc:vi.fn(async (_name:string,_args:any) => ({data:null,error:null}))}))
vi.mock('./client', () => ({supabase:{
  from:(table:string) => {mock.reads.push(table);return {select:async()=>({data:mock.tables[table]??[],error:null})}},
  rpc:mock.rpc,
  storage:{from:()=>({createSignedUrls:async()=>({data:[],error:null})})},
}}))
const idea = {id:'idea',title:'Perception project',summary:'A focused experiment on perception.',category:'Neuroscience',execution_plan:'Recruit a team.\n\nPilot and analyze.',motivation:'A long motivation.',proposer_id:'proposer',proposer_name:'Original proposer',initiative_id:'started'}
beforeEach(() => {mock.tables={project_idea_catalog:[idea]};mock.reads=[];mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:null,error:null})})

it('loads only public projections for visitors and unapproved accounts', async () => {
  const visitor = await loadLive(null)
  expect(mock.reads.sort()).toEqual(['initiative_catalog','project_idea_catalog'])
  expect(visitor.requests).toEqual([])
  expect(visitor.projectIdeas![0]).toMatchObject({plan:idea.execution_plan,proposerId:'proposer',proposerName:'Original proposer',initiativeId:'started'})
  mock.reads=[]
  mock.tables.profiles=[{id:'pending',display_name:'Pending member',account_status:'pending'}]
  const pending = await loadLive('pending')
  expect(mock.reads.sort()).toEqual(['initiative_catalog','profiles','project_idea_catalog'])
  expect(pending.projectIdeas).toEqual(visitor.projectIdeas)
  expect(pending.requests).toEqual([])
})

it('maps private requests, purposes and the resulting initiative credit for approved accounts', async () => {
  mock.tables.profiles=[{id:'applicant',display_name:'Lead',account_status:'approved'}]
  mock.tables.initiatives=[{id:'started',proposal_id:'idea',title:idea.title,summary:idea.summary,content:{execution_plan:idea.execution_plan,motivation:idea.motivation},lead_id:'applicant',status:'active'}]
  mock.tables.initiative_memberships=[{initiative_id:'started',user_id:'applicant',role:'lead'}]
  mock.tables.proposals=[{id:'idea',author_id:'proposer',title:idea.title,summary:idea.summary,purpose:'project_idea',content:{html:idea.execution_plan},status:'approved'}]
  mock.tables.idea_lead_requests=[{id:'request',proposal_id:'idea',applicant_id:'applicant',message:'I have time on weekends.',status:'approved',decision_reason:'Private feedback'}]
  const data = await loadLive('applicant')
  expect(data.initiatives[0]).toMatchObject({members:['applicant'],projectIdeaId:'idea',proposerId:'proposer',proposerName:'Original proposer'})
  expect(data.requests.find(r=>r.kind==='proposal')).toMatchObject({purpose:'project_idea',initiativeId:'started'})
  expect(data.requests.find(r=>r.kind==='idea_lead')).toMatchObject({proposalId:'idea',initiativeId:'started',title:idea.title,body:'I have time on weekends.',feedback:'Private feedback'})
})

it('preserves the save_proposal signature and omits purpose when an old client saves a draft', async () => {
  await liveAction(seed,'alex','createProposal',{id:'draft',title:'Title',abstract:'Abstract',plan:'Plan',category:'Research',motivation:'Motivation',status:'submitted',purpose:'project_idea'})
  expect(mock.rpc).toHaveBeenLastCalledWith('save_proposal',{p_id:'draft',p_title:'Title',p_summary:'Abstract',p_content:{html:'Plan',category:'Research',motivation:'Motivation',purpose:'project_idea'},p_submit:true})
  await liveAction(seed,'alex','createProposal',{id:'draft',title:'Title',abstract:'Abstract',plan:'Plan',category:'Research',status:'draft'})
  expect(mock.rpc.mock.calls.at(-1)![1].p_content).not.toHaveProperty('purpose')
  expect(mock.rpc.mock.calls.at(-1)![1].p_submit).toBe(false)
})

it('routes requests and decisions to the correct RPCs with the private note and feedback', async () => {
  await liveAction(seed,'sam','requestIdeaLead',{proposalId:'idea',body:'I can work weekends.'})
  expect(mock.rpc).toHaveBeenLastCalledWith('request_idea_lead',{p_proposal:'idea',p_message:'I can work weekends.'})
  await liveAction(seed,'maya','decideIdeaLead',{requestId:'request',decision:'approved'})
  expect(mock.rpc).toHaveBeenLastCalledWith('decide_idea_lead',{p_request:'request',p_approve:true,p_reason:''})
  await liveAction(seed,'maya','decideIdeaLead',{requestId:'request',decision:'rejected',feedback:'Please confirm availability.'})
  expect(mock.rpc).toHaveBeenLastCalledWith('decide_idea_lead',{p_request:'request',p_approve:false,p_reason:'Please confirm availability.'})
})
