export const themeStorageKey = 'rl-sim2sim-demo-theme'

/** 用户可选的主题模式；system 跟随 prefers-color-scheme。 */
export const themeModes = ['dark', 'light', 'system']

export function getStoredThemeMode() {
  if (typeof localStorage === 'undefined') {
    return 'dark'
  }
  const saved = localStorage.getItem(themeStorageKey)
  return themeModes.includes(saved) ? saved : 'dark'
}

export function prefersLightColorScheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export function resolveThemeMode(mode) {
  if (mode === 'system') {
    return prefersLightColorScheme() ? 'light' : 'dark'
  }
  return mode === 'light' ? 'light' : 'dark'
}

export function getStoredTheme() {
  return resolveThemeMode(getStoredThemeMode())
}

export function applyDocumentTheme(name) {
  if (typeof document === 'undefined') {
    return
  }
  const dark = name === 'dark'
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
}
