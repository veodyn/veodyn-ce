import { afterEach, describe, expect, it, vi } from 'vitest'
import { ttlCache } from './ttl-cache'

afterEach(() => vi.useRealTimers())

describe('ttlCache', () => {
  it('returns_a_value_until_its_ttl_passes', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const cache = ttlCache<string, number>(1000, 5)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    vi.setSystemTime(Date.now() + 1001)
    expect(cache.get('a')).toBeUndefined()
  })

  it('an_entry_can_carry_its_own_shorter_ttl', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const cache = ttlCache<string, number>(10_000, 5)
    cache.set('a', 1, 100)
    vi.setSystemTime(Date.now() + 101)
    expect(cache.get('a')).toBeUndefined()
  })

  it('evicts_the_oldest_entry_past_the_cap', () => {
    const cache = ttlCache<string, number>(1000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([undefined, 2, 3])
  })

  it('delete_removes_an_entry', () => {
    const cache = ttlCache<string, number>(1000, 2)
    cache.set('a', 1)
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
  })
})
