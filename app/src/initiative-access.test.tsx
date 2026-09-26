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

async function show(data: Data, userId: string | null, hash: string) {
  window.location.hash = hash
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => {
    root!.render(<App data={data} userId={userId} mode="demo"
      onAction={vi.fn(async () => {})} onSignIn={async () => {}} onSignOut={async () => {}} />)
    await settle()
  })
}
const tabs = () => [...host.querySelectorAll('.tabs .tab')].map(t => t.textContent)
const withOutsider = () => {
  const data = structuredClone(seed)
  data.people.push({ id: 'rio', name: 'Rio Outsider', email: 'rio@example.test', status: 'approved', roles: [] })
  return data
}

it('shows an approved non-member only the overview and team', async () => {
  await show(withOutsider(), 'rio', '#/initiative/sound/overview')
  expect(tabs()).toEqual(['Overview', 'Team'])
  await act(async () => { window.location.hash = '#/initiative/sound/tasks'; await settle() })
  expect(host.textContent).not.toContain('Document the first prototype')
})

it('keeps the workspace tabs for members and for Research/Operations', async () => {
  await show(withOutsider(), 'alex', '#/initiative/sound/overview')
  expect(tabs()).toEqual(['Overview', 'Progress', 'Tasks', 'Team', 'Activity'])
  await act(async () => root!.unmount()); root = undefined; host.remove()
  await show(withOutsider(), 'sam', '#/initiative/memory/overview')
  expect(tabs()).toEqual(['Overview', 'Progress', 'Tasks', 'Team', 'Activity'])
})

it('shows signed-out visitors the cover, motivation and team size from the public catalog', async () => {
  const data = structuredClone(seed)
  const ini = data.initiatives[0]
  Object.assign(ini, {
    members: [], memberCount: 3, tasks: [],
    coverUrl: 'https://images.example/cover.png',
    motivation: 'Navigation aids should be affordable.',
  })
  await show(data, null, `#/initiative/${ini.id}/overview`)
  expect(tabs()).toEqual(['Overview', 'Team'])
  expect(host.querySelector<HTMLElement>('.initiative-cover')?.style.background).toContain('https://images.example/cover.png')
  expect(host.textContent).toContain('Navigation aids should be affordable.')
  await act(async () => { window.location.hash = `#/initiative/${ini.id}/team`; await settle() })
  expect(host.textContent).toContain('3 members')
  await act(async () => { window.location.hash = '#/catalog'; await settle() })
  const card = [...host.querySelectorAll('.catalog-card')].find(c => c.textContent?.includes(ini.title))
  expect(card?.textContent).toContain('3 members')
})
