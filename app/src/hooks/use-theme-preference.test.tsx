import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useApplyTheme, useThemePreference } from '@/hooks/use-theme-preference'
import { THEME_STORAGE_KEY } from '@/lib/theme-preference'

// A matchMedia stand-in that can actually change its mind, which is the point:
// "follow the system setting" is not really implemented if the app only reads
// the OS once at mount and never hears about a change.
function installMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  let matches = prefersDark

  window.matchMedia = ((query: string) =>
    ({
      media: query,
      get matches() {
        return matches
      },
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener)
      },
    }) as unknown as MediaQueryList) as typeof window.matchMedia

  return {
    setPrefersDark(next: boolean) {
      matches = next
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
    },
    listenerCount: () => listeners.size,
  }
}

const realMatchMedia = window.matchMedia

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  window.matchMedia = realMatchMedia
  document.documentElement.className = ''
})

describe('useThemePreference', () => {
  it('defaults to system and resolves to light on a light OS', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.preference).toBe('system')
    expect(result.current.resolved).toBe('light')
  })

  it('resolves to dark on a dark OS without the reader choosing anything', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.preference).toBe('system')
    expect(result.current.resolved).toBe('dark')
  })

  it('lets an explicit choice override the OS', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useThemePreference())

    act(() => result.current.setPreference('light'))

    expect(result.current.preference).toBe('light')
    expect(result.current.resolved).toBe('light')
  })

  it('persists the choice so the next visit opens in the same theme', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useThemePreference())

    act(() => result.current.setPreference('dark'))

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('reads a previously stored choice on mount', () => {
    installMatchMedia(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.resolved).toBe('dark')
  })

  it('ignores a stored value it does not recognise', () => {
    installMatchMedia(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'midnight')
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.preference).toBe('system')
  })

  // The behaviour the feature is named after. Without a live subscription the
  // app would keep the theme it resolved at mount, so a reader whose OS flips
  // to dark at sunset would sit in a light app until they reloaded.
  it('follows the OS live while the preference is system', () => {
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.resolved).toBe('light')

    act(() => media.setPrefersDark(true))

    expect(result.current.resolved).toBe('dark')
  })

  it('does not follow the OS once the reader has chosen explicitly', () => {
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useThemePreference())
    act(() => result.current.setPreference('light'))

    act(() => media.setPrefersDark(true))

    expect(result.current.resolved).toBe('light')
  })

  it('unsubscribes from the media query on unmount', () => {
    const media = installMatchMedia(false)
    const { unmount } = renderHook(() => useThemePreference())
    expect(media.listenerCount()).toBe(1)

    unmount()

    expect(media.listenerCount()).toBe(0)
  })

  // localStorage does not notify the tab that wrote it, so the `storage` event
  // is exactly the case the in-tab listener set cannot cover.
  it('picks up a change made in another tab', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useThemePreference())

    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }))
    })

    expect(result.current.resolved).toBe('dark')
  })

  it('survives a browser with no matchMedia at all', () => {
    // @ts-expect-error modelling a browser without media query support.
    delete window.matchMedia
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.resolved).toBe('light')
  })
})

describe('useApplyTheme', () => {
  it('puts the class on <html>, where portalled UI can inherit it', () => {
    renderHook(() => useApplyTheme('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('removes the class when the theme goes back to light', () => {
    const { rerender } = renderHook(({ theme }) => useApplyTheme(theme), {
      initialProps: { theme: 'dark' as const },
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    rerender({ theme: 'light' as unknown as 'dark' })

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  // A cleanup that stripped the class would flash light on every navigation,
  // because React runs the cleanup before the next effect.
  it('leaves the class in place when the component unmounts', () => {
    const { unmount } = renderHook(() => useApplyTheme('dark'))
    unmount()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
