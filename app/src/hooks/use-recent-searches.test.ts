import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { RECENTS_CAP, RECENTS_KEY, useRecentSearches } from './use-recent-searches'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('useRecentSearches', () => {
  it('starts empty when storage is empty', () => {
    const { result } = renderHook(() => useRecentSearches())
    expect(result.current.recents).toEqual([])
  })

  it('hydrates from storage', () => {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(['rwa', 'bike']))
    const { result } = renderHook(() => useRecentSearches())
    expect(result.current.recents).toEqual(['rwa', 'bike'])
  })

  it('records a term at the front and persists it', () => {
    const { result } = renderHook(() => useRecentSearches())
    act(() => result.current.record('rwa'))
    expect(result.current.recents).toEqual(['rwa'])
    expect(JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]')).toEqual(['rwa'])
  })

  it('ignores an empty or whitespace term', () => {
    const { result } = renderHook(() => useRecentSearches())
    act(() => result.current.record('   '))
    expect(result.current.recents).toEqual([])
  })

  it('de-duplicates case-insensitively and promotes to the front', () => {
    const { result } = renderHook(() => useRecentSearches())
    act(() => result.current.record('rwa'))
    act(() => result.current.record('bike'))
    act(() => result.current.record('RWA'))
    expect(result.current.recents).toEqual(['RWA', 'bike'])
  })

  it('caps the list and evicts the oldest', () => {
    const { result } = renderHook(() => useRecentSearches())
    for (let i = 0; i < RECENTS_CAP + 3; i += 1) {
      act(() => result.current.record(`term-${i}`))
    }
    expect(result.current.recents).toHaveLength(RECENTS_CAP)
    expect(result.current.recents[0]).toBe(`term-${RECENTS_CAP + 2}`)
    expect(result.current.recents).not.toContain('term-0')
  })

  it('removes a single term case-insensitively', () => {
    const { result } = renderHook(() => useRecentSearches())
    act(() => result.current.record('rwa'))
    act(() => result.current.record('bike'))
    act(() => result.current.remove('RWA'))
    expect(result.current.recents).toEqual(['bike'])
  })

  it('clears every term and persists the empty list', () => {
    const { result } = renderHook(() => useRecentSearches())
    act(() => result.current.record('rwa'))
    act(() => result.current.clear())
    expect(result.current.recents).toEqual([])
    expect(JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? 'null')).toEqual([])
  })

  it('treats corrupt stored JSON as empty instead of throwing', () => {
    window.localStorage.setItem(RECENTS_KEY, '{not json')
    const { result } = renderHook(() => useRecentSearches())
    expect(result.current.recents).toEqual([])
  })

  it('ignores a stored value that is not an array of strings', () => {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify({ nope: true }))
    const { result } = renderHook(() => useRecentSearches())
    expect(result.current.recents).toEqual([])
  })

  it('picks up a change made in another tab', () => {
    const { result } = renderHook(() => useRecentSearches())
    act(() => {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(['from-other-tab']))
      window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY }))
    })
    expect(result.current.recents).toEqual(['from-other-tab'])
  })

  it('does not propagate a storage write failure', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { result } = renderHook(() => useRecentSearches())
    expect(() => act(() => result.current.record('rwa'))).not.toThrow()
    expect(result.current.recents).toEqual(['rwa'])
  })
})
