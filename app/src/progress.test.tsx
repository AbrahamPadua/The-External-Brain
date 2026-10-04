// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { groupProgress } from './progress-data'
import { Progress } from './Progress'
import App from './App'
import type { DocumentRecord } from './model'
import { seed } from './model'
import { demoAction } from './demo'

const doc = (id: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({id,initiativeId:'i',kind:'rm',title:id,authorId:'a',status:'submitted',body:'<p>Actual review text.</p>',version:1,versions:[],...extra})
const documents = [doc('rm1',{targetMonday:'2026-09-21'}), doc('rm2',{targetMonday:'2026-09-21'}),
  doc('rm3',{historical:true,sourceDate:'2026-08-19'}), doc('undated',{historical:true,sourcePeriod:'Summer',sourceWeek:'Week 1'}),
  doc('review',{kind:'review',initiativeId:'another-team',targetId:'rm1',authorName:'Source reviewer'}),
  doc('unlinked',{kind:'review',targetId:'missing'})]

it('groups RMs by week and nests cross-initiative reviews only under their actual target', () => {
  const result = groupProgress('i', documents)
  expect(result.groups[0].entries.map(e => e.rm.id)).toEqual(['rm1','rm2'])
  expect(result.groups[0].entries[0].reviews.map(r => r.id)).toEqual(['review'])
  expect(result.groups[1].monday).toBe('2026-08-17')
  expect(result.groups[2].label).toBe('Summer · Week 1')
  expect(result.otherReviews.map(r => r.id)).toEqual(['unlinked'])
  expect(groupProgress('i', documents, 'oldest').groups[0].monday).toBe('2026-08-17')
  expect(groupProgress('i', documents, 'awaiting').groups.flatMap(g => g.entries.map(e => e.rm.id))).not.toContain('rm1')
})

it('counts only published feedback in totals and ranking, keeping fresh and revision drafts recoverable',async()=>{
  const fresh=doc('draft',{kind:'review',targetId:'rm2',status:'draft',body:'<p>Unsubmitted text</p>'})
  const revision=doc('revision',{kind:'review',targetId:'rm1',status:'draft',body:'<p>Private newer edits</p>',versions:[{version:1,body:'<p>Published feedback</p>',at:'2026-09-21'}]})
  const docs=[...documents.filter(d=>d.id!=='review'),fresh,revision]
  const result=groupProgress('i',docs,'reviewed')
  expect(result.totalReviews).toBe(1)
  expect(result.groups[0].entries[0].rm.id).toBe('rm1')
  expect(result.groups[0].entries.find(e=>e.rm.id==='rm2')?.reviews).toHaveLength(0)
  expect(groupProgress('i',docs,'awaiting').groups.flatMap(g=>g.entries.map(e=>e.rm.id))).toContain('rm2')
  await mount(<Progress initiativeId="i" documents={docs} people={[]} startRm={null} onOpen={()=>{}} onRoast={()=>{}} roastReason={()=>''} busy={false}/>)
  expect(host.textContent).toContain('Open review draft')
  expect(host.textContent).toContain('Open revision draft')
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Reviews (1)'))!.click())
  expect(host.querySelector('.progress-reviews')?.textContent).toContain('Published feedback')
  expect(host.querySelector('.progress-reviews')?.textContent).not.toContain('Private newer edits')
})

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true})
afterEach(async () => {if(root) await act(async () => root!.unmount()); root=undefined; host?.remove()})
const mount = async (element: React.ReactNode) => {
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async () => root!.render(element))
}

it('expands real linked reviews, omits empty toggles, and Roasts the selected RM', async () => {
  const open=vi.fn(), roast=vi.fn()
  await mount(<Progress initiativeId="i" documents={documents} people={[]} startRm={null} currentCycle="2026-09-21"
    onOpen={open} onRoast={roast} roastReason={() => ''} busy={false} />)
  const toggle = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Reviews (1)'))!
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelectorAll('button[aria-expanded]').length).toBe(1)
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('.progress-reviews')?.textContent).toContain('Source reviewer')
  expect(host.querySelector('.progress-reviews')?.textContent).toContain('Actual review text.')
  await act(async () => (host.querySelector('.progress-reviews a') as HTMLAnchorElement).click())
  expect(open).toHaveBeenCalledWith('review')
  await act(async () => (host.querySelector('.progress-roast') as HTMLButtonElement).click())
  expect(roast).toHaveBeenCalledWith(expect.objectContaining({id:'rm1'}))
})

it('makes Progress the second tab and keeps old Documents URLs working', async () => {
  const data=structuredClone(seed)
  const person=data.people.find(p => p.status==='approved')!
  const ini=data.initiatives[0]
  window.location.hash=`#/initiative/${ini.id}/documents`
  await mount(<App data={data} userId={person.id} mode="demo" onAction={async()=>{}} onSignIn={async()=>{}} onSignOut={async()=>{}} />)
  const tabs=[...host.querySelectorAll('.tabs .tab')]
  expect(tabs.map(t => t.textContent)).toEqual(['Overview','Progress','Tasks','Team','Activity'])
  expect(tabs[1].classList.contains('active')).toBe(true)
  expect(host.querySelector('.progress-workspace')).not.toBeNull()
})

it('creates and submits a teammate review without HP or obligation changes', async () => {
  const data=structuredClone(seed)
  const ini=data.initiatives[0]
  const member=data.people.find(p=>p.status==='approved')!
  ini.members=[member.id]
  const target=doc('target',{initiativeId:ini.id,versions:[{version:1,body:'<p>Submitted work</p>',at:'2026-09-21'}]})
  data.documents.push(target)
  const payload:{targetId:string;result?:{documentId:string}}={targetId:target.id}
  const drafted=await demoAction(data,member.id,'startRmReview',payload)
  const id=payload.result!.documentId
  const repeated=await demoAction(drafted,member.id,'startRmReview',payload)
  expect(repeated.documents.filter(d=>d.id===id)).toHaveLength(1)
  const submitted=await demoAction(repeated,member.id,'submitDocument',{documentId:id,body:'<p>Useful peer feedback.</p>'})
  expect(submitted.documents.find(d=>d.id===id)).toMatchObject({status:'submitted',targetId:target.id,targetVersion:1,voluntaryReview:true})
  expect(submitted.obligations).toEqual(data.obligations)
  expect(submitted.initiatives.map(i=>i.hp)).toEqual(data.initiatives.map(i=>i.hp))
})
