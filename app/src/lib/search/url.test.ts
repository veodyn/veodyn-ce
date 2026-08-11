import { describe, expect, it } from 'vitest'
import { Boxes } from 'lucide-react'
import type { FeatureSearchType } from '@/features'
import { firstTag, normalizeTab, searchHref, searchTabs, tagHref } from './url'

/**
 * A stand-in for whatever a feature package contributes, handed to searchTabs
 * through the parameter it takes for exactly this. Same fixture and same reason
 * as grouping.test.ts's WIDGET: the cases below are about the assembly rule,
 * which is true of every build, rather than about which packages this one
 * happens to install.
 */
const WIDGET: FeatureSearchType = {
  type: 'widget',
  label: 'Widgets',
  noun: 'widgets',
  icon: Boxes,
}

describe('searchTabs', () => {
  // The answer for a build with no feature packages installed: All, then the
  // three core types. Stated as an empty contribution list rather than read off
  // the shipped SEARCH_TABS, because this file runs in a composed build too and
  // that list is longer there. url.enterprise.test.ts asserts the shipped one
  // against the real descriptors.
  it('puts All first and then every core source type in order', () => {
    expect(searchTabs([])).toEqual(['all', 'query', 'dashboard', 'catalog'])
  })

  // The ordering rule the enterprise half rests on and cannot isolate: a
  // contributed type lands after all three core types, never among them, in the
  // order it arrives. grouping.ts orders result headings the same way, so a tab
  // out of place is a bar that disagrees with the results under it.
  it('appends contributed types after the core ones, in the order given', () => {
    expect(searchTabs([WIDGET, { ...WIDGET, type: 'gauge' }])).toEqual([
      'all',
      'query',
      'dashboard',
      'catalog',
      'widget',
      'gauge',
    ])
  })
})

describe('searchHref', () => {
  it('returns the bare page for an empty query on the All tab', () => {
    expect(searchHref('', 'all')).toBe('/search')
  })

  it('encodes the query', () => {
    expect(searchHref('on-time performance', 'all')).toBe('/search?q=on-time+performance')
  })

  it('includes the type for a non-All tab', () => {
    expect(searchHref('rwa', 'query')).toBe('/search?q=rwa&type=query')
  })

  it('keeps the type when the query is empty', () => {
    expect(searchHref('', 'catalog')).toBe('/search?type=catalog')
  })
})

describe('normalizeTab', () => {
  it('accepts a known source type', () => {
    expect(normalizeTab('dashboard')).toBe('dashboard')
  })

  it('falls back to all for an unknown type', () => {
    expect(normalizeTab('bogus')).toBe('all')
  })

  it('falls back to all when absent', () => {
    expect(normalizeTab(undefined)).toBe('all')
  })

  // Driven by core types, so the case proves the rule (take the first value,
  // then apply the same recognition test to it) on any build rather than
  // depending on a tab a feature package happens to contribute.
  it('takes the first value of a repeated param', () => {
    expect(normalizeTab(['dashboard', 'query'])).toBe('dashboard')
    expect(normalizeTab(['bogus', 'dashboard'])).toBe('all')
  })
})

describe('tag facet in the URL', () => {
  it('builds a tag href with no search term', () => {
    // A tag is a facet, not a term: ?q=rail would also match everything that
    // merely mentions the word and miss anything tagged but not named for it.
    expect(tagHref('rail-history')).toBe('/search?tag=rail-history')
  })

  it('encodes a tag that needs it', () => {
    expect(tagHref('a b&c')).toBe('/search?tag=a+b%26c')
  })

  it('keeps the term and tab alongside the tag', () => {
    expect(searchHref('bus', 'query', 'rail')).toBe('/search?q=bus&type=query&tag=rail')
  })

  it('omits the tag when there is none', () => {
    expect(searchHref('bus', 'all')).toBe('/search?q=bus')
  })

  it('takes the first of a repeated tag, and trims', () => {
    expect(firstTag(['a', 'b'])).toBe('a')
    expect(firstTag('  spaced  ')).toBe('spaced')
    expect(firstTag(undefined)).toBe('')
  })
})

describe('tag survives navigation', () => {
  // Switching type from a tag search used to drop the facet, and with no term
  // the page then had nothing to search for and fell back to recents.
  it('keeps the tag when only the type changes', () => {
    expect(searchHref('', 'query', 'rail')).toBe('/search?type=query&tag=rail')
  })
})
