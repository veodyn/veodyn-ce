import { describe, expect, it } from 'vitest'
import { splitOnMatch } from './highlight'

describe('splitOnMatch', () => {
  it('returns one unmatched segment when the needle is absent', () => {
    expect(splitOnMatch('Rail Ridership', 'bus')).toEqual([
      { text: 'Rail Ridership', matched: false },
    ])
  })

  it('splits a match at the start into two segments', () => {
    expect(splitOnMatch('Rail Ridership', 'Rail')).toEqual([
      { text: 'Rail', matched: true },
      { text: ' Ridership', matched: false },
    ])
  })

  it('splits a match in the middle into three segments', () => {
    expect(splitOnMatch('Daily Bike Trips', 'Bike')).toEqual([
      { text: 'Daily ', matched: false },
      { text: 'Bike', matched: true },
      { text: ' Trips', matched: false },
    ])
  })

  it('splits a match at the end into two segments', () => {
    expect(splitOnMatch('Daily Trips', 'Trips')).toEqual([
      { text: 'Daily ', matched: false },
      { text: 'Trips', matched: true },
    ])
  })

  it('matches case-insensitively but preserves the original casing', () => {
    expect(splitOnMatch('Rail Ridership', 'rail')).toEqual([
      { text: 'Rail', matched: true },
      { text: ' Ridership', matched: false },
    ])
  })

  it('returns one unmatched segment for an empty or whitespace needle', () => {
    expect(splitOnMatch('Rail', '')).toEqual([{ text: 'Rail', matched: false }])
    expect(splitOnMatch('Rail', '   ')).toEqual([{ text: 'Rail', matched: false }])
  })

  it('treats regex metacharacters literally instead of throwing', () => {
    expect(splitOnMatch('cost (a.b*c) total', '(a.b*c)')).toEqual([
      { text: 'cost ', matched: false },
      { text: '(a.b*c)', matched: true },
      { text: ' total', matched: false },
    ])
    expect(splitOnMatch('plain text', '.*')).toEqual([{ text: 'plain text', matched: false }])
  })
})
