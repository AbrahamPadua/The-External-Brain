// @vitest-environment happy-dom
import { act } from 'react'
import { expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  verifyOtp: vi.fn(),
  verifyCode: null as null | ((email: string, code: string) => Promise<void>),
  verifyLink: null as null | ((tokenHash: string) => Promise<void>),
  authChanged: null as null | ((event: string, session: { user: { id: string; email: string } } | null) => void),
  root: null as import('react-dom/client').Root | null,
}))
vi.mock('./client', () => ({ configured: true, supabase: { auth: {
  getSession: async () => ({ data: { session: null }, error: null }),
  verifyOtp: mock.verifyOtp,
  onAuthStateChange: (callback: typeof mock.authChanged) => {
    mock.authChanged = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  },
} } }))
vi.mock('./live', () => ({ loadLive: mock.load, liveAction: vi.fn(), rememberSignup: vi.fn() }))
vi.mock('./App', () => ({ default: ({ onVerifyCode, onVerifyLink }: { onVerifyCode: (email: string, code: string) => Promise<void>, onVerifyLink: (tokenHash: string) => Promise<void> }) => {
  mock.verifyCode = onVerifyCode
  mock.verifyLink = onVerifyLink
  return <h1>Workspace ready</h1>
} }))
vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof import('react-dom/client')>()
  return { ...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    mock.root = actual.createRoot(...args)
    return mock.root
  } }
})

it('shows the real pending loader, exits on success, and preserves failure and retry', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  host.id = 'app'
  document.body.append(host)
  let finish!: (data: object) => void
  const blank = { people: [], initiatives: [], documents: [], obligations: [], threads: [], requests: [], audit: [] }
  mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  try {
    await act(async () => { await import('./main') })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Opening your workspace')
    expect(host.querySelector('.workspace-loader img')?.getAttribute('alt')).toBe('')
    await act(async () => { finish(blank) })
    expect(host.textContent).toBe('Workspace ready')
    expect(host.querySelector('.workspace-loader')).toBeNull()
    mock.verifyOtp.mockResolvedValueOnce({ error: null })
    await act(async () => { await mock.verifyCode?.('member@example.test', '123456') })
    expect(mock.verifyOtp).toHaveBeenCalledWith({ email: 'member@example.test', token: '123456', type: 'email' })
    await expect(mock.verifyCode?.('member@example.test', 'invalid')).rejects.toThrow('six-digit code')
    expect(mock.verifyOtp).toHaveBeenCalledTimes(1)
    const tokenHash = 'a'.repeat(56)
    mock.verifyOtp.mockResolvedValueOnce({ error: null })
    await act(async () => { await mock.verifyLink?.(tokenHash) })
    expect(mock.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: 'email' })
    await expect(mock.verifyLink?.('invalid')).rejects.toThrow('invalid')
    expect(mock.verifyOtp).toHaveBeenCalledTimes(2)

    mock.load.mockRejectedValueOnce(new Error('Temporary connection failure'))
    await act(async () => {
      mock.authChanged?.('SIGNED_IN', { user: { id: 'member', email: 'fictional@example.test' } })
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Temporary connection failure')
    expect(host.querySelector('.workspace-loader')).toBeNull()
    mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelector('.workspace-loader')).not.toBeNull()
    await act(async () => { finish(blank) })
    expect(host.textContent).toBe('Workspace ready')
    const loadedCalls = mock.load.mock.calls.length
    await act(async () => {
      mock.authChanged?.('TOKEN_REFRESHED', { user: { id: 'member', email: 'fictional@example.test' } })
      mock.authChanged?.('SIGNED_IN', { user: { id: 'member', email: 'fictional@example.test' } })
    })
    expect(host.textContent).toBe('Workspace ready')
    expect(host.querySelector('.workspace-loader')).toBeNull()
    expect(mock.load).toHaveBeenCalledTimes(loadedCalls)

    mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => {
      mock.authChanged?.('SIGNED_OUT', null)
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    expect(host.querySelector('.workspace-loader')).not.toBeNull()
    await act(async () => { finish(blank) })
    expect(host.textContent).toBe('Workspace ready')
  } finally {
    await act(async () => mock.root?.unmount())
    host.remove()
  }
})
