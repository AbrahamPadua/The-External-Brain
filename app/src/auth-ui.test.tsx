// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { seed } from './model'
import { isEmailLinkCallback, passwordError } from './auth'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
const handlers = () => ({
  onAction: vi.fn(async () => {}), onSignIn: vi.fn(async () => {}),
  onSignInWithPassword: vi.fn(async () => {}), onUpdatePassword: vi.fn(async () => {}),
  onVerifyCode: vi.fn(async () => {}), onVerifyLink: vi.fn(async () => {}), onSignOut: vi.fn(async () => {}),
})
async function show(hash: string, userId: string | null = null, callbacks = handlers()) {
  const data = structuredClone(seed)
  if (userId) data.people.find(p => p.id === userId)!.status = 'pending'
  window.location.hash = hash
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(<App data={data} userId={userId} mode="live" {...callbacks} />); await settle() })
  return callbacks
}
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const field = (label: string) => [...host.querySelectorAll('label')].find(el => el.querySelector('.field-label')?.textContent === label)!.querySelector('input')!
async function enter(label: string, value: string) {
  const input = field(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  })
}
const click = async (text: string) => act(async () => { button(text).click(); await settle() })
async function submit(label: string) {
  await act(async () => { field(label).closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle() })
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.restoreAllMocks() })

it('signs returning members in with a password and does not request email', async () => {
  const callbacks = await show('#/signin')
  expect(field('Password').autocomplete).toBe('current-password')
  await enter('University email', 'member@example.test')
  await enter('Password', '  correct password  ')
  await submit('Password')
  expect(callbacks.onSignInWithPassword).toHaveBeenCalledWith('member@example.test', '  correct password  ')
  expect(callbacks.onSignIn).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('#/')
})

it('keeps a failed password login on the sign-in form with an error', async () => {
  const callbacks = handlers()
  callbacks.onSignInWithPassword.mockRejectedValueOnce(new Error('The email or password is incorrect.'))
  await show('#/signin', null, callbacks)
  await enter('University email', 'member@example.test'); await enter('Password', 'incorrect password')
  await submit('Password')
  expect(window.location.hash).toBe('#/signin')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('email or password is incorrect')
  expect(host.textContent).not.toContain('Check your email')
})

it('creates an account through email verification before asking for a password', async () => {
  const callbacks = await show('#/signin')
  await click('I am new here')
  expect(host.querySelector('input[type="password"]')).toBeNull()
  await enter('Full name', 'Test Member'); await enter('University email', 'new@example.test')
  await submit('University email')
  expect(callbacks.onSignIn).toHaveBeenCalledWith('new@example.test', { name: 'Test Member', major: '', interests: '' })
  expect(callbacks.onSignInWithPassword).not.toHaveBeenCalled()
  expect(host.textContent).toContain('then set your password')
})

it('offers an email link for existing accounts and opens password setup after code verification', async () => {
  const callbacks = await show('#/signin')
  await click('Forgot password or need to set one? Use an email link')
  expect(host.querySelector('input[type="password"]')).toBeNull()
  await enter('University email', 'member@example.test'); await submit('University email')
  expect(callbacks.onSignIn).toHaveBeenCalledWith('member@example.test', undefined)
  await enter('Email code', '123456'); await submit('Email code')
  expect(callbacks.onVerifyCode).toHaveBeenCalledWith('member@example.test', '123456')
  expect(window.location.hash).toBe('#/password')
})

it('waits for confirmation before consuming an email link, then replaces its token with password setup', async () => {
  const token = 'a'.repeat(56)
  const callbacks = await show('#/confirm-email/' + token)
  expect(callbacks.onVerifyLink).not.toHaveBeenCalled()
  await click('Sign in to The External Brain')
  expect(callbacks.onVerifyLink).toHaveBeenCalledWith(token)
  expect(window.location.hash).toBe('#/password')
  expect(host.textContent).toContain('Sign in to set your password')
})

it('does not open password setup when email confirmation fails', async () => {
  const token = 'a'.repeat(56)
  const callbacks = handlers()
  callbacks.onVerifyLink.mockRejectedValueOnce(new Error('Email link expired.'))
  await show('#/confirm-email/' + token, null, callbacks)
  await click('Sign in to The External Brain')
  expect(window.location.hash).toBe('#/confirm-email/' + token)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Email link expired')
})

it('takes an already signed-in pending account from the email page to password setup without reusing the token', async () => {
  const callbacks = await show('#/confirm-email/' + 'a'.repeat(56), 'alex')
  expect(window.location.hash).toBe('#/password')
  expect(callbacks.onVerifyLink).not.toHaveBeenCalled()
  expect(host.querySelector('input[autocomplete="new-password"]')).not.toBeNull()
})

it.each(['#/password', '#/settings'])('lets a pending account save a matching password at %s without changing its profile', async hash => {
  const callbacks = await show(hash, 'alex')
  await enter('New password', 'short'); await enter('Confirm new password', 'short')
  expect(button('Save password').disabled).toBe(true)
  await submit('New password')
  expect(callbacks.onUpdatePassword).not.toHaveBeenCalled()
  await enter('New password', '  new password  '); await enter('Confirm new password', 'different password')
  expect(button('Save password').disabled).toBe(true)
  await submit('New password')
  expect(callbacks.onUpdatePassword).not.toHaveBeenCalled()
  await enter('Confirm new password', '  new password  ')
  await submit('New password')
  expect(callbacks.onUpdatePassword).toHaveBeenCalledWith('  new password  ')
  expect(callbacks.onAction).not.toHaveBeenCalled()
  expect(field('New password').value).toBe('')
  expect(field('Confirm new password').value).toBe('')
  expect(host.textContent).toContain('Password saved')
})

it('shows a server password-policy failure without announcing a successful save', async () => {
  const callbacks = handlers()
  callbacks.onUpdatePassword.mockRejectedValueOnce(new Error('Choose a stronger password.'))
  await show('#/password', 'alex', callbacks)
  await enter('New password', 'weak password'); await enter('Confirm new password', 'weak password')
  await submit('New password')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Choose a stronger password')
  expect(host.textContent).not.toContain('Password saved')
})

it('requires an authenticated account before showing the password form', async () => {
  const callbacks = await show('#/password')
  expect(host.querySelector('input[type="password"]')).toBeNull()
  expect(callbacks.onUpdatePassword).not.toHaveBeenCalled()
  expect(host.querySelector('a[href="#/signin"]')).not.toBeNull()
})

it('recognizes email callback types and compares passwords exactly', () => {
  for (const type of ['signup', 'magiclink', 'recovery', 'invite']) expect(isEmailLinkCallback(`#access_token=fictional&type=${type}`)).toBe(true)
  expect(isEmailLinkCallback('#/')).toBe(false)
  expect(isEmailLinkCallback('#error=access_denied&type=magiclink')).toBe(false)
  expect(passwordError('password ', 'password')).toBe('The passwords do not match.')
})
