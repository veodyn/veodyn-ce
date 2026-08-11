// The pre-paint <script> half of the theme vocabulary, split out of
// theme-preference.test.ts: these cases need a document, a location and a
// media query, where the forcedTheme cases next door need none of the three.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  themeInitScript,
} from '@/lib/theme-preference'
import { STUB_REGISTRY } from '@/lib/theme-preference-fixtures'
import type { FeatureDescriptor } from '@/features'

describe('themeInitScript', () => {
  // The script runs against the real document, so each case drives it the way
  // the browser does: set the world up, execute, read the class back off <html>.
  function runInitScript(registry?: Record<string, FeatureDescriptor>): void {

    new Function(themeInitScript(registry))()
  }

  function setSystemPrefersDark(prefersDark: boolean): void {
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: query.includes('dark') && prefersDark,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia
  }

  const realMatchMedia = window.matchMedia

  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    window.history.pushState({}, '', '/queries')
    setSystemPrefersDark(false)
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    window.history.pushState({}, '', '/')
  })

  function appliedTheme(): string | null {
    return document.documentElement.getAttribute('data-theme')
  }

  function hasDarkClass(): boolean {
    return document.documentElement.classList.contains('dark')
  }

  it('applies a stored dark preference before React exists', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    runInitScript()
    expect(hasDarkClass()).toBe(true)
    expect(appliedTheme()).toBe('dark')
  })

  it('applies a stored light preference even when the OS prefers dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    setSystemPrefersDark(true)
    runInitScript()
    expect(hasDarkClass()).toBe(false)
    expect(appliedTheme()).toBe('light')
  })

  it('follows the OS when nothing is stored', () => {
    setSystemPrefersDark(true)
    runInitScript()
    expect(hasDarkClass()).toBe(true)
  })

  it('follows the OS when the stored value is the system default', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    setSystemPrefersDark(true)
    runInitScript()
    expect(hasDarkClass()).toBe(true)
    expect(DEFAULT_THEME_PREFERENCE).toBe('system')
  })

  it('falls back to light when the browser has no matchMedia', () => {
    // @ts-expect-error deliberately modelling a browser without media queries.
    delete window.matchMedia
    runInitScript()
    expect(hasDarkClass()).toBe(false)
    expect(appliedTheme()).toBe('light')
  })

  it('ignores an unrecognised stored value rather than applying it', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'midnight')
    setSystemPrefersDark(true)
    runInitScript()
    // Falls through to the OS, not to the junk value.
    expect(hasDarkClass()).toBe(true)
  })

  // The half of the feature that only shows up as a flash: without the rules
  // serialised into the script, a reader whose stored preference disagrees
  // with a forced surface gets one frame of the wrong theme. Driven by the
  // explicit registry, so what is under test is that a declared rule reaches
  // the pre-paint script and outranks storage there, not which surfaces a
  // build happens to declare.
  it('bakes a declared dark rule in, over a stored light preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    window.history.pushState({}, '', '/beta/3')
    runInitScript(STUB_REGISTRY)
    expect(hasDarkClass()).toBe(true)
  })

  it('bakes a declared light rule in, over a stored dark preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.history.pushState({}, '', '/alpha/42/paper')
    runInitScript(STUB_REGISTRY)
    expect(hasDarkClass()).toBe(false)
    expect(appliedTheme()).toBe('light')
  })

  it('forces an embedded widget light even when the reader prefers dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.history.pushState({}, '', '/embed/query/9')
    runInitScript()
    expect(hasDarkClass()).toBe(false)
  })

  it('clears a stale dark class rather than only ever adding one', () => {
    document.documentElement.classList.add('dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    runInitScript()
    expect(hasDarkClass()).toBe(false)
  })

  it('still forces an embedded widget light in the pre-paint script with an empty registry', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.history.pushState({}, '', '/embed/query/9')
    runInitScript({})
    expect(hasDarkClass()).toBe(false)
  })

  it('no longer forces the presentation surface dark in the pre-paint script with an empty registry', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    window.history.pushState({}, '', '/present/3')
    runInitScript({})
    // Reverts to the reader's stored preference, light here, rather than the
    // feature-owned dark-by-design rule.
    expect(hasDarkClass()).toBe(false)
  })

  it('no longer forces the print route light in the pre-paint script with an empty registry', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.history.pushState({}, '', '/reports/42/print')
    runInitScript({})
    expect(hasDarkClass()).toBe(true)
  })

  it('survives a localStorage that throws, which is a real privacy mode', () => {
    const realLocalStorage = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    setSystemPrefersDark(true)
    try {
      expect(() => runInitScript()).not.toThrow()
      // The preference is unreadable, but the OS setting still lands.
      expect(hasDarkClass()).toBe(true)
    } finally {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: realLocalStorage,
      })
    }
  })
})
