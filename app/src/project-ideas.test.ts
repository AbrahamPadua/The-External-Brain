import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoAction, normalizeDemo, readProposal } from './demo'
import { seed } from './model'
import type { Data, ProposalPurpose } from './model'

const proposal = {title:'Perception project',abstract:'A focused student experiment on perception.',category:'Neuroscience',plan:'Recruit a team.\n\nPilot in week two; analyze in week three.',motivation:Array(151).fill('reason').join(' '),status:'submitted'}
const fresh = () => structuredClone(seed)
const submit = (data:Data,purpose:ProposalPurpose='project_idea') => demoAction(data,'alex','createProposal',{...proposal,purpose})
async function publish() {
  let data = await submit(fresh())
  const id = data.requests[0].id
  data = await demoAction(data,'maya','decideProposal',{requestId:id,decision:'approved'})
  return {data,id}
}
afterEach(() => vi.useRealTimers())

describe('proposal purposes', () => {
  it.each<ProposalPurpose>(['project_idea','own_initiative'])('uses identical field requirements for %s', async purpose => {
    for (const invalid of [{title:'ab'},{abstract:'short'},{plan:'short'},{motivation:Array(149).fill('word').join(' ')}]) {
      await expect(demoAction(fresh(),'alex','createProposal',{...proposal,...invalid,purpose})).rejects.toThrow()
    }
    const data = await submit(fresh(),purpose)
    expect(data.requests[0].purpose).toBe(purpose)
    expect(readProposal(data.requests[0].body)).toEqual({abstract:proposal.abstract,category:proposal.category,plan:proposal.plan,motivation:proposal.motivation})
  })

  it('preserves draft content and purpose for old clients, and lets the resubmission action choose purpose', async () => {
    let data = await submit(fresh())
    const id = data.requests[0].id
    data = await demoAction(data,'maya','decideProposal',{requestId:id,decision:'changes_requested',feedback:'Explain the timeline.'})
    data = await demoAction(data,'alex','createProposal',{...proposal,id,status:'draft'})
    expect(data.requests[0]).toMatchObject({purpose:'project_idea',feedback:'Explain the timeline.',status:'draft'})
    expect(readProposal(data.requests[0].body).plan).toBe(proposal.plan)
    data = await demoAction(data,'alex','createProposal',{...proposal,id,purpose:'own_initiative'})
    expect(data.requests[0]).toMatchObject({purpose:'own_initiative',status:'submitted',feedback:undefined})
    await expect(demoAction(data,'alex','createProposal',{...proposal,id,purpose:'unknown'})).rejects.toThrow('Invalid proposal purpose')
  })

  it('publishes only approved ideas without changing teams, obligations, or HP', async () => {
    const initial = fresh()
    const submitted = await submit(initial)
    expect(submitted.projectIdeas).toEqual([])
    const data = await demoAction(submitted,'maya','decideProposal',{requestId:submitted.requests[0].id,decision:'approved'})
    expect(data.initiatives).toEqual(initial.initiatives)
    expect(data.obligations).toEqual(initial.obligations)
    expect(data.projectIdeas).toHaveLength(1)
    expect(data.projectIdeas![0]).toMatchObject({proposerId:'alex',proposerName:'Alex Rivera',plan:proposal.plan,motivation:proposal.motivation})
    expect(data.projectIdeas![0]).not.toHaveProperty('feedback')
    expect(data.projectIdeas![0]).not.toHaveProperty('body')
    const again = await demoAction(data,'maya','decideProposal',{requestId:submitted.requests[0].id,decision:'approved'})
    expect(again).toEqual(data)
  })

  it('defaults old saved proposals to own initiatives and preserves existing assignments', async () => {
    const data = fresh()
    data.requests.push({id:'legacy',kind:'proposal',userId:'alex',title:proposal.title,status:'pending',body:JSON.stringify(proposal)})
    const normalized = normalizeDemo(data)
    expect(normalized.requests[0]).toMatchObject({status:'submitted',purpose:'own_initiative'})
    expect(normalized.projectIdeas).toEqual([])
    const approved = await demoAction(normalized,'maya','decideProposal',{requestId:'legacy',decision:'approved'})
    expect(approved.initiatives.slice(1)).toEqual(seed.initiatives)
    expect(approved.initiatives[0]).toMatchObject({leadId:'alex',members:['alex'],abstract:proposal.abstract,executionPlan:proposal.plan})
  })
})

describe('requests to lead', () => {
  it('accepts multiple applicants and starts only one initiative, retaining content and proposer credit', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    let {data,id} = await publish()
    data = await demoAction(data,'sam','requestIdeaLead',{proposalId:id,body:'I can work weekends and recruit a team.'})
    const winner = data.requests[0].id
    const duplicate = await demoAction(data,'sam','requestIdeaLead',{proposalId:id,body:'I can work weekends and recruit a team.'})
    expect(duplicate).toEqual(data)
    data = await demoAction(data,'alex','requestIdeaLead',{proposalId:id,body:'As the proposer I can also lead next term.'})
    const competitor = data.requests[0].id
    const obligations = structuredClone(data.obligations)
    data = await demoAction(data,'maya','decideIdeaLead',{requestId:winner,decision:'approved'})
    const initiative = data.initiatives[0]
    expect(initiative).toMatchObject({leadId:'sam',members:['sam'],abstract:proposal.abstract,executionPlan:proposal.plan,motivation:proposal.motivation,category:proposal.category,projectIdeaId:id,proposerId:'alex',proposerName:'Alex Rivera',hp:100})
    expect(data.obligations).toEqual(obligations)
    expect(data.requests.find(r => r.id === competitor)?.status).toBe('taken')
    expect(data.projectIdeas![0].initiativeId).toBe(initiative.id)
    const again = await demoAction(data,'maya','decideIdeaLead',{requestId:winner,decision:'approved'})
    expect(again).toEqual(data)
    expect(await demoAction(data,'maya','decideIdeaLead',{requestId:competitor,decision:'approved'})).toEqual(data)
    expect(data.notifications?.filter(n => n.kind === 'idea_lead_decided')).toHaveLength(2)
    expect(data.notifications?.filter(n => n.kind === 'project_idea_started')).toHaveLength(1)
    await expect(demoAction(data,'maya','requestIdeaLead',{proposalId:id,body:'Can I start another team?'})).rejects.toThrow('unavailable')
    data = await demoAction(data,'maya','openCycle',{monday:'2026-09-28'})
    expect(data.obligations.filter(o => o.initiativeId === initiative.id)).toEqual([])
    data = await demoAction(data,'maya','openCycle',{monday:'2026-10-05'})
    expect(data.obligations.filter(o => o.initiativeId === initiative.id)).toHaveLength(2)
    expect(data.obligations.filter(o => o.initiativeId === initiative.id).every(o => o.assigneeId === 'sam')).toBe(true)
  })

  it('checks current account approval and Research permissions and requires decline feedback', async () => {
    let {data,id} = await publish()
    await expect(demoAction(data,'jordan','requestIdeaLead',{proposalId:id,body:'I have time to lead.'})).rejects.toThrow('approved')
    data = await demoAction(data,'sam','requestIdeaLead',{proposalId:id,body:'I have time to lead.'})
    const requestId = data.requests[0].id
    await expect(demoAction(data,'sam','decideIdeaLead',{requestId,decision:'approved'})).rejects.toThrow('Only Research')
    data.people.find(p => p.id === 'sam')!.status = 'suspended'
    await expect(demoAction(data,'maya','decideIdeaLead',{requestId,decision:'approved'})).rejects.toThrow('applicant must be approved')
    await expect(demoAction(data,'maya','decideIdeaLead',{requestId,decision:'rejected'})).rejects.toThrow('feedback')
    data = await demoAction(data,'maya','decideIdeaLead',{requestId,decision:'rejected',feedback:'Please confirm your availability.'})
    expect(data.requests[0]).toMatchObject({status:'rejected',feedback:'Please confirm your availability.'})
    expect(await demoAction(data,'maya','decideIdeaLead',{requestId,decision:'rejected',feedback:'Retry'})).toEqual(data)
    expect(data.projectIdeas![0].initiativeId).toBeUndefined()
  })
})
