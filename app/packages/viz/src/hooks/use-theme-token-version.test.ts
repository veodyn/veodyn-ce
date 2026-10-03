import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useThemeTokenVersion } from './use-theme-token-version'

afterEach(() => {
  document.documentElement.className = ''
})

describe('useThemeTokenVersion', () => {
  it('changes when the theme class is added', async () => {
    const { result } = renderHook(() => useThemeTokenVersion())
    const before = result.current

    await act(async () => {
      document.documentElement.classList.add('dark')
    })

    expect(result.current).not.toBe(before)
  })

  it('changes again when the theme class is removed', async () => {
    document.documentElement.classList.add('dark')
    const { result } = renderHook(() => useThemeTokenVersion())
    const before = result.current

    await act(async () => {
      document.documentElement.classList.remove('dark')
    })

    expect(result.current).not.toBe(before)
  })

  it('does not change when an unrelated attribute changes', async () => {
    const { result } = renderHook(() => useThemeTokenVersion())
    const before = result.current

    await act(async () => {
      document.documentElement.setAttribute('lang', 'de')
    })

    expect(result.current).toBe(before)
  })
})
