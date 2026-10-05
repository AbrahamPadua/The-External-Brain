// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App, { createMutationGateway } from './App'
import { demoAction } from './demo'
import { seed } from './model'
import type { AccountStatus, Data, ProposalPurpose } from './model'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
const settle = () => new Promise(resolve => setTimeout(resolve,20))
const proposal = {title:'Perception project',abstract:'A focused student experiment on perception.',category:'Neuroscience',plan:'Recruit a team.\n\nPilot in week two; analyze in week three.',motivation:Array(151).fill('reason').join(' ')}
const draftData = (invalid={}) => {
  const data = structuredClone(seed)
  data.requests.push({id:'draft',kind:'proposal',userId:'alex',title:proposal.title,status:'draft',body:JSON.stringify({...proposal,...invalid})})
  return data
}
async function publishedData() {
  let data = await demoAction(structuredClone(seed),'alex','createProposal',{...proposal,purpose:'project_idea',status:'submitted'})
  const id = data.requests[0].id
  data = await demoAction(data,'maya','decideProposal',{requestId:id,decision:'approved'})
  return {data,id}
}
async function show(data: Data, userId: string|null, hash: string, onAction=vi.fn(async (_name:string,_payload:any) => {})) {
  if (!root) {host=document.createElement('div');document.body.append(host);root=createRoot(host)}
  await act(async () => {
    window.location.hash=hash;window.dispatchEvent(new Event('hashchange'))
    root!.render(<App data={data} userId={userId} mode="demo" onAction={onAction} onSignIn={async()=>{}} onSignOut={async()=>{}} />)
    await settle()
  })
  return onAction
}
const button = (text:string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim()===text)!
const click = async (text:string) => act(async () => {button(text).click();await settle()})
afterEach(async () => {if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();vi.restoreAllMocks()})

it.each<[string,ProposalPurpose]>([['Submit to Brainstorm Genesis','project_idea'],['Submit to lead this project','own_initiative']])('explicitly submits the same saved content using %s', async (label,purpose) => {
  const data = draftData()
  const onAction = await show(data,'alex','#/new-proposal/draft')
  expect(host.textContent).toContain('New project proposal')
  expect(host.textContent).toContain('You won’t be added to a team.')
  expect(host.textContent).toContain('you’ll become the initiative lead.')
  expect(button(label).type).toBe('button')
  const form = host.querySelector('form.card')!
  const enter = new Event('submit',{bubbles:true,cancelable:true})
  await act(async()=>{form.dispatchEvent(enter);await settle()})
  expect(enter.defaultPrevented).toBe(true)
  expect(onAction).not.toHaveBeenCalled()
  await click(label)
  expect(onAction).toHaveBeenCalledWith('createProposal',expect.objectContaining({...proposal,id:'draft',status:'submitted',purpose}))
})

it.each([{abstract:'short'},{plan:'short'},{motivation:Array(149).fill('word').join(' ')}])('requires the same fields before either submission: %j', async invalid => {
  await show(draftData(invalid),'alex','#/new-proposal/draft')
  expect(button('Submit to Brainstorm Genesis').disabled).toBe(true)
  expect(button('Submit to lead this project').disabled).toBe(true)
  expect(button('Save draft').disabled).toBe(false)
})

it.each(['changes_requested','draft'])('shows the prior purpose and feedback on %s and saves drafts without choosing a new purpose', async status => {
  const data = draftData()
  Object.assign(data.requests[0],{status,purpose:'project_idea',feedback:'Explain the timeline.'})
  const onAction = await show(data,'alex','#/new-proposal/draft')
  expect(host.textContent).toContain('Previously submitted as: Brainstorm Genesis')
  expect(host.textContent).toContain('Explain the timeline.')
  await click('Save draft')
  expect(onAction).toHaveBeenCalledWith('createProposal',expect.objectContaining({...proposal,status:'draft'}))
  expect(onAction.mock.calls[0][1]).not.toHaveProperty('purpose')
})

it('labels both purposes in the Research queue and My proposals', async () => {
  let data = await demoAction(structuredClone(seed),'alex','createProposal',{...proposal,purpose:'project_idea',status:'submitted'})
  data = await demoAction(data,'alex','createProposal',{...proposal,purpose:'own_initiative',status:'submitted'})
  await show(data,'maya','#/')
  const queue = host.querySelector('.dashboard-proposal-queue')!
  expect(queue.textContent).toContain('Brainstorm Genesis')
  expect(queue.textContent).toContain('Proposed initiative')
  expect(queue.textContent).toContain('Approve & publish idea')
  expect(queue.textContent).toContain('Approve & create initiative')
  await show(data,'alex','#/')
  expect(host.querySelector('.dashboard-proposals')?.textContent).toContain('Brainstorm Genesis')
  expect(host.querySelector('.dashboard-proposals')?.textContent).toContain('Proposed initiative')
})

it.each<AccountStatus|null>([null,'pending','rejected','suspended'])('hides the ideas tab and blocks idea catalog/detail links for %s accounts even with cached content', async status => {
  const {data,id} = await publishedData()
  const userId=status ? 'jordan' : null
  if(status)data.people.find(p=>p.id==='jordan')!.status=status
  await show(data,userId,'#/catalog')
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Initiatives')
  expect(host.querySelector('a[role="tab"][href="#/catalog/project-ideas"]')).toBeNull()
  for(const hash of ['#/catalog/project-ideas',`#/project-idea/${id}`, '#/project-idea/unknown']) {
    await show(data,userId,hash)
    expect(host.textContent).toContain('An approved account is needed here')
    expect(host.querySelector('.project-idea-content')).toBeNull()
    expect(host.querySelector('.idea-catalog-card')).toBeNull()
    expect(host.querySelector('input[aria-label="Search Brainstorm Genesis"]')).toBeNull()
    for(const privateContent of [proposal.title,proposal.abstract,proposal.plan,proposal.motivation,'Proposed by Alex Rivera'])expect(host.textContent).not.toContain(privateContent)
    expect(host.querySelector('a[href="#/catalog/project-ideas"]')).toBeNull()
    expect([...host.querySelectorAll('button')].map(b=>b.textContent)).not.toContain('Request to lead')
  }
})

it('provides member catalog tabs, approved content and proposer credit without exposing drafts or notes', async () => {
  const {data,id} = await publishedData()
  data.requests.push({id:'private-draft',kind:'proposal',userId:'alex',purpose:'project_idea',title:'Private draft title',body:'Private draft body',status:'draft'})
  data.requests.push({id:'private-note',kind:'idea_lead',proposalId:id,userId:'sam',title:proposal.title,body:'Private applicant note',status:'pending'})
  await show(data,'sam','#/catalog')
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Initiatives')
  await show(data,'sam','#/catalog/project-ideas')
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Brainstorm Genesis')
  expect(host.querySelector(`a[href="#/project-idea/${id}"]`)?.textContent).toContain(proposal.title)
  expect(host.textContent).not.toContain('Private draft title')
  expect(host.textContent).not.toContain('Private applicant note')
  await show(data,'alex',`#/project-idea/${id}`)
  expect(host.textContent).toContain('Available to lead')
  expect(host.textContent).toContain('Proposed by Alex Rivera')
  for (const name of ['Abstract','Execution plan','Motivation']) expect(host.querySelector(`section[aria-label="${name}"]`)).not.toBeNull()
  expect(host.textContent).toContain(proposal.plan)
  expect(button('Request to lead')).toBeDefined()
  expect(host.textContent).not.toContain('Private applicant note')
  await show(data,'jordan',`#/project-idea/${id}`)
  expect(host.textContent).toContain('An approved account is needed here')
  expect(host.querySelector('.project-idea-content')).toBeNull()
  await show(data,'alex',`#/project-idea/${id}`)
  expect(host.querySelector('.project-idea-content')).not.toBeNull()
})

it('shows Research the private lead queue and shows each applicant only their own Home requests', async () => {
  let {data,id} = await publishedData()
  data = await demoAction(data,'sam','requestIdeaLead',{proposalId:id,body:'I can work weekends and recruit a team.'})
  const winner = data.requests[0].id
  data = await demoAction(data,'alex','requestIdeaLead',{proposalId:id,body:'I can help on Mondays as the proposer.'})
  const onAction = await show(data,'maya','#/')
  expect(host.querySelector('.dashboard-lead-queue')?.textContent).toContain('Sam Patel')
  expect(host.querySelector('.dashboard-lead-queue')?.textContent).toContain('I can work weekends')
  expect(host.querySelector('.dashboard-lead-queue')?.textContent).toContain('Approved Brainstorm Genesis proposal')
  await act(async()=>{host.querySelector<HTMLButtonElement>('.dashboard-lead-queue .btn')!.click();await settle()})
  expect(onAction).toHaveBeenCalledWith('decideIdeaLead',expect.objectContaining({decision:'approved'}))
  await show(data,'sam','#/')
  expect(host.querySelector('.dashboard-lead-queue')).toBeNull()
  expect(host.querySelector('.dashboard-lead-requests')?.textContent).toContain('Pending')
  expect(host.textContent).not.toContain('I can help on Mondays')
  data = await demoAction(data,'maya','decideIdeaLead',{requestId:winner,decision:'approved'})
  await show(data,'alex','#/')
  expect(host.querySelector('.dashboard-lead-requests')?.textContent).toContain('Taken up by another member')
  expect(host.querySelector('.dashboard-lead-requests')?.textContent).not.toContain('Rejected')
  await show(data,'alex','#/catalog/project-ideas')
  expect(host.querySelector('.idea-catalog-card')).toBeNull()
  await show(data,'alex',`#/project-idea/${id}`)
  const initiative = data.initiatives[0]
  expect(host.querySelector(`a[href="#/initiative/${initiative.id}/overview"]`)?.textContent).toContain('Open resulting initiative')
  await show(data,null,`#/initiative/${initiative.id}/overview`)
  expect(host.textContent).toContain('Idea proposed by Alex Rivera')
  expect(host.querySelector(`a[href="#/project-idea/${id}"]`)).toBeNull()
  await show(data,'alex',`#/initiative/${initiative.id}/overview`)
  expect(host.querySelector(`a[href="#/project-idea/${id}"]`)?.textContent).toBe('Original Brainstorm Genesis proposal')
  await show(data,null,`#/project-idea/${id}`)
  expect(host.textContent).toContain('An approved account is needed here')
  expect(host.querySelector(`a[href="#/initiative/${initiative.id}/overview"]`)).toBeNull()
})

it('sorts and filters only available approved ideas by discipline and proposer search', async () => {
  const {data} = await publishedData()
  const original = data.projectIdeas![0]
  data.projectIdeas = [
    {...original,id:'zebra',title:'Zebra experiment',category:'Other',proposerName:'Weekend proposer'},
    {...original,id:'alpha',title:'Alpha experiment',category:'Neuroscience'},
    {...original,id:'taken',title:'Already started',initiativeId:'sound'},
  ]
  await show(data,'sam','#/catalog/project-ideas')
  const titles = () => [...host.querySelectorAll('.idea-catalog-card h3')].map(h=>h.textContent)
  expect(titles()).toEqual(['Alpha experiment','Zebra experiment'])
  await act(async()=>{
    const sort=host.querySelector<HTMLSelectElement>('select[aria-label="Sort Brainstorm Genesis"]')!
    sort.value='desc';sort.dispatchEvent(new Event('change',{bubbles:true}));await settle()
  })
  expect(titles()).toEqual(['Zebra experiment','Alpha experiment'])
  await act(async()=>{
    const discipline=[...host.querySelectorAll<HTMLButtonElement>('.catalog-chip')].find(b=>b.textContent?.startsWith('Neuroscience'))!
    discipline.click();await settle()
  })
  expect(titles()).toEqual(['Alpha experiment'])
  await act(async()=>{host.querySelector<HTMLButtonElement>('.catalog-chip')!.click();await settle()})
  await act(async()=>{
    const search=host.querySelector<HTMLInputElement>('input[type="search"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'Weekend proposer')
    search.dispatchEvent(new Event('input',{bubbles:true}));await settle()
  })
  expect(titles()).toEqual(['Zebra experiment'])
})

it('routes both new lead actions through the read-only role-preview gateway', async () => {
  const onAction = vi.fn(async()=>{})
  const gateway = createMutationGateway({onAction,isPreviewing:()=>true,setBusy:()=>{},setError:()=>{},setNotice:()=>{}})
  expect(await gateway.run('requestIdeaLead',{proposalId:'idea',body:'I have time.'})).toBe(false)
  expect(await gateway.run('decideIdeaLead',{requestId:'request',decision:'approved'})).toBe(false)
  expect(onAction).not.toHaveBeenCalled()
})
