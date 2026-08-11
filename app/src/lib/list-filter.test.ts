import { describe, expect, it } from 'vitest'
import { matchesSearch } from '@/lib/list-filter'

describe('matchesSearch', () => {
  it('matches everything while the box is empty', () => {
    expect(matchesSearch('', ['Rail ridership'])).toBe(true)
    expect(matchesSearch('   ', ['Rail ridership'])).toBe(true)
  })

  it('ignores case and matches inside a word', () => {
    expect(matchesSearch('RIDER', ['Rail ridership'])).toBe(true)
  })

  it('looks across every field it was given', () => {
    expect(matchesSearch('planning', ['Bike counts', 'Planning'])).toBe(true)
  })

  it('narrows as terms are added, rather than widening', () => {
    // Both terms present, in different fields.
    expect(matchesSearch('rail ops', ['Rail ridership', 'Ops'])).toBe(true)
    // The second term is nowhere.
    expect(matchesSearch('rail finance', ['Rail ridership', 'Ops'])).toBe(false)
  })

  it('is not confused by fields that are absent', () => {
    expect(matchesSearch('rail', ['Rail ridership', null, undefined])).toBe(true)
    expect(matchesSearch('rail', [null, undefined])).toBe(false)
  })
})
