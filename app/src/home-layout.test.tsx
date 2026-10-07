// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { seed } from './model'
import type { Data } from './model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
const settle = () => new Promise(resolve => setTimeout(resolve, 30))
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove() })

async function show(data: Data, userId: string, hash = '#/') {
  window.location.hash = hash
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => {
    root!.render(<App data={data} userId={userId} mode="demo"
      onAction={vi.fn(async () => {})} onSignIn={async () => {}} onSignOut={async () => {}} />)
    await settle()
  })
}
const navLabels = () => [...host.querySelectorAll('a')].map(a => a.textContent?.trim() ?? '')
const withJoin = () => {
  const data = structuredClone(seed)
  data.requests = [...data.requests.filter(r => r.kind !== 'join'),
    { id: 'j-test', kind: 'join', userId: 'sam', initiativeId: 'memory', title: 'Join', body: 'Keen to help', status: 'pending' }]
  return data
}

it('hides the Health page from members and leads, and shows it to Research and Operations', async () => {
  await show(structuredClone(seed), 'alex')
  expect(navLabels()).not.toContain('Health')
  // Members still see each initiative's HP on its card.
  expect(host.querySelector('.catalog-card .hp')).not.toBeNull()
  await act(async () => root!.unmount()); root = undefined; host.remove()

  await show(structuredClone(seed), 'alex', '#/health')
  expect(host.textContent).not.toContain('Initiative health')
  await act(async () => root!.unmount()); root = undefined; host.remove()

  await show(structuredClone(seed), 'sam')
  expect(navLabels()).toContain('Health')
})

it('drops the Proposals and Join requests pages from navigation', async () => {
  await show(structuredClone(seed), 'maya')
  expect(navLabels()).not.toContain('Proposals')
  expect(navLabels()).not.toContain('Join requests')
})

it('puts join requests on the initiative card for its lead', async () => {
  await show(withJoin(), 'alex')
  const card = [...host.querySelectorAll('.home-initiative')].find(c => c.textContent?.includes('Memory in Motion'))
  expect(card?.querySelector('.catalog-card')).not.toBeNull()
  expect(card?.querySelector('.initiative-joins')?.textContent).toContain('Sam Patel')
  expect(card?.querySelector('.initiative-joins button')?.textContent).toContain('Add to team')
})

it('keeps proposals reachable while work is pending for Member and Research', async () => {
  await show(structuredClone(seed), 'alex')
  expect(host.querySelector('.dashboard-proposals a[href="#/new-proposal"]')?.textContent).toContain('Propose a project')
  await act(async () => root!.unmount()); root = undefined; host.remove()

  await show(structuredClone(seed), 'maya')
  expect(host.querySelector('.dashboard-proposals a[href="#/new-proposal"]')).not.toBeNull()
})

it('does not let a historical week satisfy a current weekly obligation', async () => {
  await show(structuredClone(seed), 'alex')
  const weekly = host.querySelector('.dashboard-rm') ?? [...host.querySelectorAll('.dashboard-section')].find(s=>s.textContent?.includes('Your Roast Mes'))
  expect(weekly?.textContent).toContain('Start draft')
  expect(weekly?.textContent).not.toContain('View report')
})

it('shows waiting and unavailable review assignments without a start action', async () => {
  const data = structuredClone(seed)
  data.obligations.push({id:'wait',initiativeId:'memory',assigneeId:'alex',kind:'review',due:'2026-09-14T06:59:00Z',status:'pending'})
  data.obligations.push({id:'missing',initiativeId:'memory',assigneeId:'alex',kind:'review',due:'2026-09-14T06:59:00Z',status:'pending',targetId:'gone'})
  await show(data, 'alex')
  const reviews = host.querySelector('.dashboard-reviews')!
  expect(reviews.textContent).toContain('Waiting for Research')
  expect(reviews.textContent).toContain('Report unavailable')
  expect(reviews.querySelector('button')).toBeNull()
})

it('retains this week’s completed update with a submitted action and separate revision indication',async()=>{
  const data=structuredClone(seed)
  const {losAngelesMonday}=await import('./domain')
  const monday=losAngelesMonday()
  const ob=data.obligations.find(o=>o.id==='o3')!
  Object.assign(ob,{cycleMonday:monday,status:'complete'})
  const report=data.documents.find(d=>d.id==='rm-memory')!
  Object.assign(report,{obligationId:ob.id,targetMonday:monday,status:'draft',versions:[{version:1,body:'<p>Submitted report</p>',at:'2026-10-02T10:00:00Z'}]})
  await show(data,'alex')
  const row=host.querySelector('.dashboard-rm')!
  expect(row.textContent).toContain('Submitted')
  expect(row.textContent).toContain('Revision draft')
  expect(row.querySelector('a[href="#/document/rm-memory"]')?.textContent).toContain('View report')
})
