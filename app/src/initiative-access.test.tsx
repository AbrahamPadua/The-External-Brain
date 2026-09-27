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
const go = async (hash: string) => act(async () => { window.location.hash = hash; await settle() })
const tabs = () => [...host.querySelectorAll('.tabs .tab')].map(t => t.textContent)
const withOutsider = () => {
  const data = structuredClone(seed)
  data.people.push({ id: 'rio', name: 'Rio Outsider', email: 'rio@example.test', status: 'approved', roles: [] })
  return data
}

it('gives every approved account the whole initiative, team or not', async () => {
  await show(withOutsider(), 'rio', '#/initiative/sound/overview')
  expect(tabs()).toEqual(['Overview', 'Progress', 'Tasks', 'Team', 'Activity'])
  await go('#/initiative/sound/tasks')
  expect(host.textContent).toContain('Document the first prototype')
})

it('shows signed-out visitors everything except progress, tasks and activity', async () => {
  const data = structuredClone(seed)
  const ini = data.initiatives[0]
  Object.assign(ini, {
    status: 'stopped', hp: 70,
    coverUrl: 'https://images.example/cover.png',
    motivation: 'Navigation aids should be affordable.',
  })
  await show(data, null, `#/initiative/${ini.id}/overview`)
  expect(tabs()).toEqual(['Overview', 'Team'])
  expect(host.querySelector<HTMLElement>('.initiative-cover')?.style.background).toContain('https://images.example/cover.png')
  expect(host.textContent).toContain('Navigation aids should be affordable.')
  expect(host.querySelector('.hp')?.textContent).toContain('70')

  await go(`#/initiative/${ini.id}/tasks`)
  expect(host.textContent).not.toContain('Document the first prototype')
  await go(`#/initiative/${ini.id}/team`)
  expect(host.textContent).toContain('Maya Chen')
  expect(host.textContent).toContain('Alex Rivera')

  await go('#/catalog')
  expect(host.querySelector('select[aria-label="Filter by status"]')).not.toBeNull()
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]')!
    select.value = 'stopped'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
  })
  const card = [...host.querySelectorAll('.catalog-card')].find(c => c.textContent?.includes(ini.title))
  expect(card?.querySelector('.hp')).not.toBeNull()
})
