/** Match the workspace's saved preference before rendering its loading screen. */
export function readDarkTheme(): boolean {
  try {
    const saved = localStorage.getItem('openlabs-theme')
    if (saved === 'dark' || saved === 'light') return saved === 'dark'
  } catch { /* Storage may be unavailable in a restricted browser. */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}
