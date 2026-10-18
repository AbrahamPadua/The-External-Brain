export const PASSWORD_MIN_LENGTH = 8

export function passwordError(password: string, confirmation?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`
  if (confirmation !== undefined && password !== confirmation) return 'The passwords do not match.'
  return null
}

/** Supabase consumes this fragment before rendering the application. */
export function isEmailLinkCallback(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return params.has('access_token') && ['signup', 'magiclink', 'recovery', 'invite'].includes(params.get('type') ?? '')
}

/** Replace the email confirmation URL with the password page. */
export function openPasswordSetup(): void {
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + '#/password')
  window.dispatchEvent(new Event('hashchange'))
}
