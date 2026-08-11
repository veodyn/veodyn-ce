import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeckCycle } from '@/hooks/use-deck-cycle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDeckCycle', () => {
  it('starts at index 0 and auto-advances every dwellMs, wrapping around', () => {
    const { result } = renderHook(() => useDeckCycle({ count: 3, dwellMs: 1000, enabled: true }))

    expect(result.current.index).toBe(0)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.index).toBe(1)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.index).toBe(2)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.index).toBe(0)
  })

  it('does not auto-advance when disabled, even with more than one slide', () => {
    // count > 1 so only the `enabled` guard can stop the interval (count: 1
    // would pass even if the enabled guard were removed).
    const { result } = renderHook(() => useDeckCycle({ count: 3, dwellMs: 1000, enabled: false }))

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.index).toBe(0)
  })

  it('does not auto-advance when count is 1, even if enabled', () => {
    const { result } = renderHook(() => useDeckCycle({ count: 1, dwellMs: 1000, enabled: true }))

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.index).toBe(0)
  })

  it('halts auto-advance while paused and resumes once unpaused', () => {
    const { result } = renderHook(() => useDeckCycle({ count: 3, dwellMs: 1000, enabled: true }))

    act(() => {
      result.current.setPaused(true)
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.index).toBe(0)
    expect(result.current.paused).toBe(true)

    act(() => {
      result.current.setPaused(false)
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.index).toBe(1)
    expect(result.current.paused).toBe(false)
  })

  it('next() and prev() wrap around the ends', () => {
    const { result } = renderHook(() => useDeckCycle({ count: 3, dwellMs: 1000, enabled: false }))

    act(() => {
      result.current.prev()
    })
    expect(result.current.index).toBe(2)

    act(() => {
      result.current.next()
    })
    expect(result.current.index).toBe(0)

    act(() => {
      result.current.next()
    })
    expect(result.current.index).toBe(1)
  })

  it('goTo clamps out-of-range targets into a valid index', () => {
    const { result } = renderHook(() => useDeckCycle({ count: 3, dwellMs: 1000, enabled: false }))

    act(() => {
      result.current.goTo(5)
    })
    expect(result.current.index).toBe(2)

    act(() => {
      result.current.goTo(-5)
    })
    expect(result.current.index).toBe(0)
  })

  it('clamps a stale index into range when count shrinks', () => {
    const { result, rerender } = renderHook(({ count }) => useDeckCycle({ count, dwellMs: 1000, enabled: false }), {
      initialProps: { count: 5 },
    })

    act(() => {
      result.current.goTo(4)
    })
    expect(result.current.index).toBe(4)

    rerender({ count: 2 })
    expect(result.current.index).toBeLessThanOrEqual(1)

    // After the shrink, next() must actually move off the displayed slide: with
    // a stale stored index of 4 and count 2, an unclamped (4 + 1) % 2 would
    // land back on the same displayed slide instead of advancing.
    const displayed = result.current.index
    act(() => {
      result.current.next()
    })
    expect(result.current.index).not.toBe(displayed)
    expect(result.current.index).toBeLessThanOrEqual(1)
  })
})
