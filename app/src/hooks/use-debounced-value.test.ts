import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 200))
    expect(result.current).toBe('a')
  })

  it('does not update the value before delayMs elapses', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'b' })
    act(() => {
      vi.advanceTimersByTime(199)
    })

    expect(result.current).toBe('a')
  })

  it('updates to the latest value once delayMs elapses with no further changes', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'b' })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(result.current).toBe('b')
  })

  it('collapses rapid successive updates so only the last value settles', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ value: 'abc' })
    act(() => {
      // Elapsed since the last change is only 100ms: below the 200ms delay,
      // so the timer that 'abc' reset must still be pending.
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('abc')
  })

  it('clears the pending timer on unmount so no late update fires', () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'b' })
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
