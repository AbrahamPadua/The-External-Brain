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
