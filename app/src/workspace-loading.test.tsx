// @vitest-environment happy-dom
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import type { ProfileDetails } from './model'

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  rememberSignup: vi.fn(),
  signIn: null as null | ((email: string, details?: ProfileDetails) => Promise<void>),
  passwordSignIn: null as null | ((email: string, password: string) => Promise<void>),
  updatePassword: null as null | ((password: string) => Promise<void>),
  verifyCode: null as null | ((email: string, code: string) => Promise<void>),
  verifyLink: null as null | ((tokenHash: string) => Promise<void>),
  authChanged: null as null | ((event: string, session: { user: { id: string; email: string } } | null) => void),
  root: null as import('react-dom/client').Root | null,
}))
vi.mock('./client', () => ({ configured: true, supabase: { auth: {
  getSession: async () => ({ data: { session: null }, error: null }),
  verifyOtp: mock.verifyOtp,
  signInWithOtp: mock.signInWithOtp,
  signInWithPassword: mock.signInWithPassword,
  updateUser: mock.updateUser,
  onAuthStateChange: (callback: typeof mock.authChanged) => {
    mock.authChanged = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  },
} } }))
vi.mock('./live', () => ({ loadLive: mock.load, liveAction: vi.fn(), rememberSignup: mock.rememberSignup }))
vi.mock('./App', () => ({ default: ({ onVerifyCode, onVerifyLink, onSignIn, onSignInWithPassword, onUpdatePassword }: {
  onVerifyCode: (email: string, code: string) => Promise<void>, onVerifyLink: (tokenHash: string) => Promise<void>,
  onSignIn: (email: string, details?: ProfileDetails) => Promise<void>,
  onSignInWithPassword: (email: string, password: string) => Promise<void>, onUpdatePassword: (password: string) => Promise<void>,
}) => {
  mock.verifyCode = onVerifyCode
  mock.verifyLink = onVerifyLink
  mock.signIn = onSignIn
  mock.passwordSignIn = onSignInWithPassword
  mock.updatePassword = onUpdatePassword
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  host.id = 'app'
  document.body.append(host)
  let finish!: (data: object) => void
  const blank = { people: [], initiatives: [], documents: [], obligations: [], threads: [], requests: [], audit: [] }
  mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  window.location.hash = '#access_token=fictional&type=signup'
  try {
    await act(async () => { await import('./main') })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Opening your workspace')
    expect(host.querySelector('.workspace-loader img')?.getAttribute('alt')).toBe('')
    await act(async () => { finish(blank); await vi.advanceTimersByTimeAsync(3000) })
    expect(host.textContent).toBe('Workspace ready')
    expect(host.querySelector('.workspace-loader')).toBeNull()
    // Emulate the SDK consuming the email fragment before delivering a session.
    window.location.hash = '#/'
    mock.signInWithOtp.mockResolvedValue({ error: null })
    const details = { name: 'Test Member', major: 'Neuroscience', interests: 'Memory' }
    await act(async () => { await mock.signIn?.('new@example.test', details) })
    expect(mock.signInWithOtp).toHaveBeenLastCalledWith({ email: 'new@example.test', options: {
      shouldCreateUser: true, emailRedirectTo: window.location.origin + window.location.pathname,
      data: { display_name: details.name, major: details.major, interests: details.interests },
    } })
    expect(mock.rememberSignup).toHaveBeenCalledWith('new@example.test', details)
    await act(async () => { await mock.signIn?.('member@example.test') })
    expect(mock.signInWithOtp).toHaveBeenLastCalledWith({ email: 'member@example.test', options: {
      shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname,
    } })
    mock.signInWithPassword.mockResolvedValueOnce({ error: null })
    await act(async () => { await mock.passwordSignIn?.(' member@example.test ', '  password unchanged  ') })
    expect(mock.signInWithPassword).toHaveBeenCalledWith({ email: 'member@example.test', password: '  password unchanged  ' })
    mock.signInWithPassword.mockResolvedValueOnce({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    await expect(mock.passwordSignIn?.('member@example.test', 'wrong')).rejects.toThrow('use an email sign-in link')
    await expect(mock.updatePassword?.('new password')).rejects.toThrow('Sign in before')
    expect(mock.updateUser).not.toHaveBeenCalled()
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
      await vi.advanceTimersByTimeAsync(3000)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(window.location.hash).toBe('#/password')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Temporary connection failure')
    expect(host.querySelector('.workspace-loader')).toBeNull()
    mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelector('.workspace-loader')).not.toBeNull()
    await act(async () => { finish(blank); await vi.advanceTimersByTimeAsync(3000) })
    expect(host.textContent).toBe('Workspace ready')
    const loadedCalls = mock.load.mock.calls.length
    await expect(mock.updatePassword?.('short')).rejects.toThrow('at least 8')
    expect(mock.updateUser).not.toHaveBeenCalled()
    mock.updateUser.mockResolvedValueOnce({ error: null })
    await act(async () => { await mock.updatePassword?.('  new password  ') })
    expect(mock.updateUser).toHaveBeenCalledWith({ password: '  new password  ' })
    mock.updateUser.mockResolvedValueOnce({ error: { message: 'Password is too weak' } })
    await expect(mock.updatePassword?.('weak password')).rejects.toThrow('Password is too weak')
    await act(async () => {
      mock.authChanged?.('TOKEN_REFRESHED', { user: { id: 'member', email: 'fictional@example.test' } })
      mock.authChanged?.('SIGNED_IN', { user: { id: 'member', email: 'fictional@example.test' } })
      mock.authChanged?.('USER_UPDATED', { user: { id: 'member', email: 'fictional@example.test' } })
    })
    expect(host.textContent).toBe('Workspace ready')
    expect(host.querySelector('.workspace-loader')).toBeNull()
    expect(mock.load).toHaveBeenCalledTimes(loadedCalls)
    window.location.hash = '#/'
    await act(async () => { mock.authChanged?.('PASSWORD_RECOVERY', { user: { id: 'member', email: 'fictional@example.test' } }) })
    expect(window.location.hash).toBe('#/password')
    expect(mock.load).toHaveBeenCalledTimes(loadedCalls)

    mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => {
      mock.authChanged?.('SIGNED_OUT', null)
      await vi.advanceTimersByTimeAsync(3000)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(host.querySelector('.workspace-loader')).not.toBeNull()
    await act(async () => { finish(blank); await vi.advanceTimersByTimeAsync(3000) })
    expect(host.textContent).toBe('Workspace ready')
  } finally {
    await act(async () => mock.root?.unmount())
    host.remove()
    vi.useRealTimers()
  }
})
