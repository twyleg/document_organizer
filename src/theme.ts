export type Theme = 'light' | 'dark'
const storageKey = 'document-organizer.theme'

export function initializeTheme(): Theme {
  let saved: string | null = null
  try { saved = localStorage.getItem(storageKey) } catch { /* Theme works without storage. */ }
  const theme = saved === 'light' || saved === 'dark' ? saved : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  applyTheme(theme)
  return theme
}

export function applyTheme(theme: Theme, persist = false) {
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.bsTheme = theme
  if (persist) {
    try { localStorage.setItem(storageKey, theme) } catch { /* Keep the selected theme for this session. */ }
  }
}
