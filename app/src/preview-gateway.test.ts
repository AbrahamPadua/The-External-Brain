// @vitest-environment happy-dom
/**
 * Role preview is read-only. Behavioural regression, not a source assertion.
 *
 *   npx vitest run src/preview-gateway.test.ts
 *
 * The defect this pins: `run` refused while previewing, but ctx.uploadRmImage and
 * ctx.uploadTaskImage called the host directly, so a previewing account could
 * still upload bytes and register an attachment. These tests drive the REAL
 * objects App builds (createMutationGateway returns the very functions assigned
 * to ctx.run / ctx.uploadRmImage / ctx.uploadTaskImage) with a spy host, and
 * assert the host is never reached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMutationGateway, PREVIEW_REFUSAL } from './App'
import type { MutationGateway } from './App'

let onAction: ReturnType<typeof vi.fn>
let previewing: boolean
let gateway: MutationGateway
let errors: (string | null)[]
let busy: boolean[]

const png = () => new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' })

beforeEach(() => {
  previewing = false
  errors = []
  busy = []
  // A host that would succeed: any call reaching it is a real mutation.
  onAction = vi.fn(async (_action: string, payload: any) => {
    if (payload && 'result' in payload) payload.result = { path: 'i/a.png', url: 'https://x/1' }
  })
  gateway = createMutationGateway({
    onAction: onAction as unknown as (a: string, p: any) => Promise<void>,
    isPreviewing: () => previewing,
    setBusy: (v) => busy.push(v),
    setError: (m) => errors.push(m),
    setNotice: () => {},
  })
})

/** Every mutation entrypoint ctx exposes, so a new one cannot be forgotten here. */
const entrypoints: { name: string; call: () => Promise<unknown> }[] = [
  { name: 'run', call: () => gateway.run('deleteTask', { taskId: 't' }, 'Deleted.') },
  { name: 'uploadRmImage', call: () => gateway.uploadRmImage('d1', 'i1', png()) },
  { name: 'uploadTaskImage', call: () => gateway.uploadTaskImage('t1', 'i1', png()) },
]

describe('mutations reach the host when not previewing', () => {
  it.each(entrypoints)('$name dispatches', async ({ call }) => {
    await expect(call()).resolves.toBeDefined()
    expect(onAction).toHaveBeenCalledTimes(1)
  })
})

describe('no mutation reaches the host while previewing', () => {
  it.each(entrypoints)('$name is refused without calling onAction', async ({ name, call }) => {
    previewing = true
    if (name === 'run') {
      await expect(call()).resolves.toBe(false)
    } else {
      // An upload must reject, or the editor would insert an image for it.
      await expect(call()).rejects.toThrow(PREVIEW_REFUSAL)
    }
    expect(onAction).not.toHaveBeenCalled()
    expect(errors).toContain(PREVIEW_REFUSAL)
  })

  it('refuses every entrypoint in one previewing session', async () => {
    previewing = true
    await gateway.run('addTask', { title: 'x' }).catch(() => {})
    await gateway.uploadRmImage('d', 'i', png()).catch(() => {})
    await gateway.uploadTaskImage('t', 'i', png()).catch(() => {})
    expect(onAction).not.toHaveBeenCalled()
  })

  it('still clears the busy flag, so the UI does not stay locked', async () => {
    previewing = true
    await gateway.run('addTask', { title: 'x' })
    expect(busy[busy.length - 1]).toBe(false)
  })
})

describe('callbacks captured before the preview started', () => {
  it('refuses a stale callback that fires after entering preview', async () => {
    // The shape of a queued autosave or a file-picker handler: built while the
    // account had full rights, invoked after the preview banner went up.
    const queued = () => gateway.run('saveDraft', { documentId: 'd1', body: '<p>x</p>' })
    previewing = true
    await expect(queued()).resolves.toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('refuses a stale upload callback that fires after entering preview', async () => {
    const queued = () => gateway.uploadRmImage('d1', 'i1', png())
    previewing = true
    await expect(queued()).rejects.toThrow(PREVIEW_REFUSAL)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('does not expose an in-flight upload result after preview starts', async () => {
    let finish!: () => void
    onAction.mockImplementationOnce(async (_action: string, payload: any) => {
      await new Promise<void>((resolve) => { finish = resolve })
      payload.result = { path: 'i/late.png', url: 'https://x/late' }
    })
    const upload = gateway.uploadTaskImage('t1', 'i1', png())
    expect(onAction).toHaveBeenCalledTimes(1)
    previewing = true
    finish()
    await expect(upload).rejects.toThrow(PREVIEW_REFUSAL)
    // This dispatch began before preview. The completion-time refusal is what
    // prevents its returned URL from being inserted after the boundary.
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('resumes dispatching once the preview is exited', async () => {
    previewing = true
    await gateway.run('addTask', { title: 'x' })
    expect(onAction).not.toHaveBeenCalled()
    previewing = false
    await expect(gateway.run('addTask', { title: 'x' })).resolves.toBe(true)
    expect(onAction).toHaveBeenCalledTimes(1)
  })
})

describe('a real host failure is still reported as itself', () => {
  it('does not disguise an ordinary error as a preview refusal', async () => {
    onAction.mockRejectedValueOnce(new Error('lead or admin required'))
    await expect(gateway.run('deleteTask', { taskId: 't' })).resolves.toBe(false)
    expect(errors).toContain('lead or admin required')
    expect(errors).not.toContain(PREVIEW_REFUSAL)
  })

  it('reports a failed upload as a failed upload', async () => {
    onAction.mockImplementationOnce(async () => { /* leaves payload.result null */ })
    await expect(gateway.uploadRmImage('d', 'i', png())).rejects.toThrow('Upload failed')
  })
})
