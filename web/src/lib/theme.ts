import { useLayoutEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const storageKey = 'league-cloud-coach-theme'
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(storageKey, theme)
    } catch {
      /* Theme still works without browser storage. */
    }
  }, [theme])
  return [theme, setTheme] as const
}
