// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { seed } from './model'
import { demoAction } from './demo'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
const settle = () => new Promise(resolve => setTimeout(resolve, 30))
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.restoreAllMocks() })

it('edits in place, uploads into the abstract and keeps bottom actions and cover controls positioned', async () => {
  const data = structuredClone(seed)
  const ini = data.initiatives[0]
  ini.overviewHtml = '<p>First paragraph of the initiative.</p><p>Second paragraph.</p>'
  ini.abstract = 'Obsolete abstract'
  const person = data.people[0]
  person.status = 'approved'
  person.roles = ['research']
  ini.leadId = 'someone-else'
  ini.members = []
  window.location.hash = `#/initiative/${ini.id}/overview`
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const onAction = vi.fn(async (action: string, p: any) => {
    if (action === 'uploadInitiativeImage') p.result = {path: `${ini.id}/image.png`, url: 'https://images.example/picture.png'}
  })
  const render = async () => {
    await act(async () => { root!.render(<App data={data} userId={person.id} mode="demo"
      onAction={onAction} onSignIn={async () => {}} onSignOut={async () => {}} />); await settle() })
  }
  await render()
  expect(host.querySelector('.initiative-abstract')?.textContent).toContain('First paragraph of the initiative.')
  expect(host.querySelector('.initiative-abstract')?.textContent).not.toContain('Obsolete abstract')
  expect(host.querySelector('.initiative-edit-action')?.textContent).toContain('Edit initiative')
  expect(host.querySelector('.initiative-join-action')?.textContent).toContain('Ask to join')
  expect(host.querySelector('.initiative-cover .initiative-cover-controls')?.textContent).toContain('Manage cover')
  expect([...host.querySelectorAll('h3')].map(h => h.textContent)).not.toContain('Overview')
  await act(async () => { (host.querySelector('.initiative-edit-action button') as HTMLButtonElement).click(); await settle() })
  expect(host.querySelectorAll('.initiative-content-section [contenteditable="true"]').length).toBe(2)
  expect(host.querySelector('.initiative-edit-action form')).toBeNull()
  expect(host.querySelector('.initiative-edit-action [contenteditable]')).toBeNull()
  const input = host.querySelector('.initiative-abstract input[type="file"]') as HTMLInputElement
  expect(input).not.toBeNull()
  Object.defineProperty(input, 'files', {value: [new File(['image'], 'picture.png', {type:'image/png'})], configurable:true})
  await act(async () => { input.dispatchEvent(new Event('change', {bubbles:true})); await settle() })
  expect(onAction).toHaveBeenCalledWith('uploadInitiativeImage', expect.objectContaining({initiativeId: ini.id}))
  expect(host.querySelector('.initiative-abstract img')?.getAttribute('data-object-path')).toBe(`${ini.id}/image.png`)
  await act(async () => { (host.querySelector('.initiative-edit-action button') as HTMLButtonElement).click(); await settle() })
  expect(onAction).toHaveBeenCalledWith('updateInitiativeContent', expect.objectContaining({abstractHtml: expect.stringContaining('data-object-path')}))
  person.roles = []
  await render()
  expect(host.querySelector('.initiative-edit-action')?.textContent).not.toContain('Edit initiative')
  ini.members = [person.id]
  await render()
  expect(host.querySelector('.initiative-edit-action')?.textContent).toContain('Edit initiative')
})

it('saves and reloads a multiline abstract for a member without restoring the old overview', async () => {
  const data = structuredClone(seed)
  const ini = data.initiatives[0]
  const member = data.people[0]
  member.status = 'approved'
  member.roles = []
  ini.leadId = 'someone-else'
  ini.members = [member.id]
  ini.overviewHtml = '<p>Old overview</p>'
  const abstract = 'First paragraph.\n\nSecond paragraph.\nOne more line.'
  const saved = await demoAction(data, member.id, 'updateInitiativeDetails', {
    initiativeId: ini.id, title: ini.title, abstract, category: ini.category, motivation: '',
  })
  const reloaded = JSON.parse(JSON.stringify(saved))
  expect(reloaded.initiatives[0].abstract).toBe(abstract)
  expect(reloaded.initiatives[0].overviewHtml).toBe('')
})
