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

it('hides Health from members and leads, and shows it to Research and Operations', async () => {
  await show(structuredClone(seed), 'alex')
  expect(navLabels()).not.toContain('Health')
  expect(host.querySelector('.hp')).toBeNull()
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
  const card = [...host.querySelectorAll('.initiative-card')].find(c => c.textContent?.includes('Memory in Motion'))
  expect(card?.querySelector('.initiative-card-joins')?.textContent).toContain('Sam Patel')
  expect(card?.querySelector('.initiative-card-joins button')?.textContent).toContain('Add to team')
})

it('shows proposals on Home only when nothing is pending', async () => {
  await show(structuredClone(seed), 'alex')
  expect(host.querySelector('.dashboard-proposals')).toBeNull()
  await act(async () => root!.unmount()); root = undefined; host.remove()

  const clear = structuredClone(seed)
  clear.obligations = clear.obligations.filter(o => o.assigneeId !== 'alex')
  clear.requests = clear.requests.filter(r => !(r.kind === 'join' && r.status === 'pending'))
  await show(clear, 'alex')
  expect(host.querySelector('.dashboard-proposals a[href="#/new-proposal"]')).not.toBeNull()
})
