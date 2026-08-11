import { describe, expect, it } from 'vitest'
import { rankDiscover } from './discover'
import type { MockDashboard, MockQuery } from '@/lib/mock-data'

function dash(over: Partial<MockDashboard>): MockDashboard {
  return {
    id: 1,
    name: 'D',
    is_favorite: false,
    updated_at: '2020-01-01T00:00:00Z',
    ...over,
  } as MockDashboard
}

function qry(over: Partial<MockQuery>): MockQuery {
  return {
    id: 1,
    name: 'Q',
    is_favorite: false,
    updated_at: '2020-01-01T00:00:00Z',
    ...over,
  } as MockQuery
}

describe('rankDiscover', () => {
  it('ranks a favorite above a more-recent non-favorite', () => {
    const ranked = rankDiscover(
      [
        dash({ id: 1, name: 'Star', is_favorite: true, updated_at: '2020-01-01T00:00:00Z' }),
        dash({ id: 2, name: 'Recent', is_favorite: false, updated_at: '2026-01-01T00:00:00Z' }),
      ],
      []
    )
    expect(ranked[0].name).toBe('Star')
  })

  it('orders favorites by recency and non-favorites by recency', () => {
    const ranked = rankDiscover(
      [
        dash({ id: 1, name: 'FavOld', is_favorite: true, updated_at: '2024-01-01T00:00:00Z' }),
        dash({ id: 2, name: 'FavNew', is_favorite: true, updated_at: '2026-06-01T00:00:00Z' }),
        dash({ id: 3, name: 'PlainNew', is_favorite: false, updated_at: '2026-05-01T00:00:00Z' }),
      ],
      []
    )
    expect(ranked.map((i) => i.name)).toEqual(['FavNew', 'FavOld', 'PlainNew'])
  })

  it('unifies dashboards and queries with the right hrefs and respects the limit', () => {
    const ranked = rankDiscover(
      [dash({ id: 1, name: 'Top', is_favorite: true, updated_at: '2026-06-01T00:00:00Z' })],
      [qry({ id: 2, name: 'AQuery', is_favorite: false, updated_at: '2025-01-01T00:00:00Z' })],
      2
    )
    expect(ranked.length).toBe(2)
    expect(ranked[0]).toMatchObject({ type: 'dashboard', href: '/dashboards/1' })
    expect(ranked.find((i) => i.type === 'query')?.href).toBe('/queries/2')
  })

  it('keeps favorites first even for an extreme-past favorite date', () => {
    // A finite favorite bonus could be beaten by a very negative epoch; the hard
    // favorites-first tier must hold regardless of the date.
    const ranked = rankDiscover(
      [
        dash({ id: 1, name: 'AncientFav', is_favorite: true, updated_at: '-271821-04-20T00:00:00.000Z' }),
        dash({ id: 2, name: 'RecentPlain', is_favorite: false, updated_at: '2026-01-01T00:00:00Z' }),
      ],
      []
    )
    expect(ranked[0].name).toBe('AncientFav')
  })

  it('respects the default limit of 12', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      dash({ id: i + 1, name: `D${i}`, updated_at: '2026-01-01T00:00:00Z' })
    )
    expect(rankDiscover(many, [])).toHaveLength(12)
  })
})
