import { describe, expect, it } from 'vitest'
import {
  RESERVED_PREFIX,
  countTags,
  isReserved,
  mergeTagCounts,
  normalizeTag,
  resolveTagCandidate,
  visibleTags,
} from './tags'

describe('normalizeTag', () => {
  // Matching is exact and case sensitive downstream, so without all three of
  // these `rail`, `Rail` and `rail ` become three unrelated tags.
  it('trims, collapses inner whitespace and lowercases', () => {
    expect(normalizeTag('  Rail  ')).toBe('rail')
    expect(normalizeTag('Air   Quality')).toBe('air quality')
    expect(normalizeTag('\tRAIL\nRIDERSHIP ')).toBe('rail ridership')
  })

  it('collapses a whitespace-only value to the empty string', () => {
    expect(normalizeTag('   ')).toBe('')
  })

  it('leaves an already normalized tag untouched', () => {
    expect(normalizeTag('bike-share')).toBe('bike-share')
  })
})

describe('isReserved', () => {
  it('matches the prefix the hub scanner uses and nothing else', () => {
    expect(RESERVED_PREFIX).toBe('domain:')
    expect(isReserved('domain:rail')).toBe(true)
    expect(isReserved('domain:')).toBe(true)
    expect(isReserved('rail')).toBe(false)
    // Not a substring test: a tag that merely mentions the word is a real tag.
    expect(isReserved('my-domain:rail')).toBe(false)
    expect(isReserved('subdomain:rail')).toBe(false)
  })

  it('refuses a typed reserved tag once it has been normalized', () => {
    expect(isReserved(normalizeTag('  Domain:Rail '))).toBe(true)
  })
})

describe('visibleTags', () => {
  it('drops reserved tags and keeps the order of the rest', () => {
    expect(visibleTags(['rail', 'domain:transit', 'ridership'])).toEqual(['rail', 'ridership'])
  })

  it('returns an empty list when every tag is reserved', () => {
    expect(visibleTags(['domain:transit', 'domain:air'])).toEqual([])
  })

  it('does not mutate its input', () => {
    const tags = ['rail', 'domain:transit']
    visibleTags(tags)
    expect(tags).toEqual(['rail', 'domain:transit'])
  })
})

describe('resolveTagCandidate', () => {
  // The defect this function exists to prevent: normalizing a picked tag wrote
  // `rail` beside the `Rail` that was on screen, and neither chip then found
  // the other's objects. Matching downstream is exact and case sensitive.
  it('stores a vocabulary pick exactly as the vocabulary spells it', () => {
    expect(resolveTagCandidate({ source: 'vocabulary', value: 'Rail' })).toBe('Rail')
    expect(resolveTagCandidate({ source: 'vocabulary', value: 'Air Quality' })).toBe('Air Quality')
  })

  // Spec decision 3. Without this, `rail`, `Rail` and `rail ` typed fresh
  // become three unrelated tags going forward.
  it('normalizes typed text', () => {
    expect(resolveTagCandidate({ source: 'typed', value: '  Rail  ' })).toBe('rail')
    expect(resolveTagCandidate({ source: 'typed', value: 'Air   Quality' })).toBe('air quality')
  })

  it('resolves a blank value to nothing, whichever end it came from', () => {
    expect(resolveTagCandidate({ source: 'typed', value: '   ' })).toBe('')
    expect(resolveTagCandidate({ source: 'vocabulary', value: '   ' })).toBe('')
  })
})

describe('mergeTagCounts', () => {
  // The whole point of the merge: one tag used across two backends is one
  // suggestion with the summed count, not two entries or the larger of the two.
  it('sums the count when a name appears in more than one source', () => {
    const merged = mergeTagCounts([
      [{ name: 'rail', count: 8 }],
      [{ name: 'rail', count: 4 }],
      [{ name: 'rail', count: 1 }],
    ])
    expect(merged).toEqual([{ name: 'rail', count: 13 }])
  })

  it('sorts by count descending then name ascending', () => {
    const merged = mergeTagCounts([
      [
        { name: 'zebra', count: 2 },
        { name: 'apple', count: 2 },
        { name: 'rail', count: 9 },
      ],
    ])
    expect(merged.map((t) => t.name)).toEqual(['rail', 'apple', 'zebra'])
  })

  it('drops reserved tags so they can never be suggested', () => {
    const merged = mergeTagCounts([
      [
        { name: 'domain:transit', count: 40 },
        { name: 'rail', count: 1 },
      ],
    ])
    expect(merged).toEqual([{ name: 'rail', count: 1 }])
  })

  it('merges an empty source list to an empty vocabulary', () => {
    expect(mergeTagCounts([[], []])).toEqual([])
  })
})

describe('countTags', () => {
  it('counts each tag once per object carrying it', () => {
    const counted = countTags([
      { tags: ['rail', 'ridership'] },
      { tags: ['rail'] },
      { tags: [] },
    ])
    expect(counted.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'rail', count: 2 },
      { name: 'ridership', count: 1 },
    ])
  })

  // KPIs and reports do not carry tags yet on every deployment, and a fixture
  // can be missing the field entirely. Neither may take the suggestion list out.
  it('ignores objects with no tags field and non-string entries', () => {
    expect(countTags([{}, { tags: null }, { tags: [1, '', 'rail'] }])).toEqual([
      { name: 'rail', count: 1 },
    ])
  })
})
