import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useReducedMotion } from '@/hooks/use-reduced-motion'

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
}

// Stubs matchMedia with a single persistent MediaQueryList whose `matches`
// can be flipped after the fact and whose `change` listener is captured, so
// a test can simulate the browser firing a real change event.
function stubMatchMediaWithListener(initialMatches: boolean) {
  let currentMatches = initialMatches
  let changeListener: (() => void) | null = null

  const mql = {
    get matches() {
      return currentMatches
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((event: string, callback: () => void) => {
      if (event === 'change') changeListener = callback
    }),
    removeEventListener: vi.fn((event: string, callback: () => void) => {
      if (event === 'change' && changeListener === callback) changeListener = null
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }

  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => mql))

  return {
    setMatches(value: boolean) {
      currentMatches = value
    },
    fireChange() {
      changeListener?.()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReducedMotion', () => {
  it('reports true when the user prefers reduced motion', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('reports false when the user does not prefer reduced motion', () => {
    stubMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('updates when the underlying matchMedia change event fires', () => {
    const mql = stubMatchMediaWithListener(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => {
      mql.setMatches(true)
      mql.fireChange()
    })

    expect(result.current).toBe(true)
  })
})
