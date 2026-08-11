'use client'

// The reader's light/dark choice, remembered per browser.
//
// `useSyncExternalStore` rather than "useState plus an effect", for the same
// reason use-sidebar-collapsed.ts uses it: the server has no localStorage and
// no media query, so the value needs a server snapshot React can reconcile
// against. This follows that file's shape deliberately, including the local
// listener set (the `storage` event fires only in the OTHER tabs, so changing
// the theme in one tab moves all of them, but the tab that wrote it needs its
// own nudge).
//
// Two stores, not one object: getSnapshot has to return something referentially
// stable or React re-renders forever, and two primitives are stable for free
// where a `{preference, system}` object rebuilt on every call is not.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DARK_MEDIA_QUERY,
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme-preference'

const listeners = new Set<() => void>()

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function preferenceSnapshot(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  // Anything unrecognised (a hand-edited value, a key left by an older build)
  // reads as the default rather than throwing the app into an unknown theme.
  return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE
}

// jsdom does not implement matchMedia at all, and neither do a few older
// embedded browsers, so every use of it is feature-detected. Absent means "no
// opinion", which resolves to light.
function darkMedia(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_MEDIA_QUERY) : null
}

function subscribeSystem(listener: () => void): () => void {
  const media = darkMedia()
  if (!media) return () => {}
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function systemSnapshot(): boolean {
  return darkMedia()?.matches ?? false
}

function serverPreference(): ThemePreference {
  return DEFAULT_THEME_PREFERENCE
}

function serverSystemPrefersDark(): boolean {
  return false
}

export interface ThemePreferenceState {
  /** What the reader chose, which may be 'system'. */
  preference: ThemePreference
  /** What that means right now, after consulting the OS. */
  resolved: ResolvedTheme
  setPreference: (next: ThemePreference) => void
}

export function useThemePreference(): ThemePreferenceState {
  const preference = useSyncExternalStore(
    subscribePreference,
    preferenceSnapshot,
    serverPreference
  )
  const systemPrefersDark = useSyncExternalStore(
    subscribeSystem,
    systemSnapshot,
    serverSystemPrefersDark
  )

  const setPreference = useCallback((next: ThemePreference) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
    // localStorage does not notify the tab that wrote it.
    for (const listener of listeners) listener()
  }, [])

  return { preference, resolved: resolveTheme(preference, systemPrefersDark), setPreference }
}

/**
 * Puts the resolved theme on <html>, which is what actually decides which token
 * block wins.
 *
 * On the document element rather than on a wrapper: CSS inheritance follows the
 * DOM, and every portalled surface (dialog, popover, select, tooltip, dropdown,
 * command palette) renders into document.body, outside any wrapper this
 * provider could put the class on.
 *
 * The class is normally already correct when this first runs, because
 * themeInitScript() set it before paint. This keeps it correct afterwards: a
 * preference change, an OS change, and a client-side navigation onto or off a
 * forced surface all land here.
 */
export function useApplyTheme(theme: ResolvedTheme): void {
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.setAttribute('data-theme', theme)
    // No cleanup: this sets both states rather than adding one, so the next run
    // fully replaces this one. A cleanup that stripped the class would flash
    // the light theme on every navigation.
  }, [theme])
}
