import { describe, expect, it } from 'vitest'
import { computeFreshestStalest } from './notable-changes'
import type { Dataset } from '@/types/catalog'

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    name: 'Dataset 1',
    description: 'A dataset',
    domain: null,
    schema: [],
    freshness: { lastUpdatedAt: '2026-07-20T00:00:00Z', status: 'fresh' },
    coverage: { start: '2020-01-01T00:00:00Z', end: '2026-07-20T00:00:00Z' },
    rowCount: 100,
    sources: [],
    tags: [],
    sampleQueryId: null,
    origin: 'capture',
    writable: false,
    ...overrides,
  }
}

describe('computeFreshestStalest', () => {
  it('returns the most-recent dataset as freshest and the oldest as stalest', () => {
    const datasets = [
      dataset({ id: 'mid', freshness: { lastUpdatedAt: '2026-07-15T00:00:00Z', status: 'fresh' } }),
      dataset({ id: 'newest', freshness: { lastUpdatedAt: '2026-07-22T00:00:00Z', status: 'fresh' } }),
      dataset({ id: 'oldest', freshness: { lastUpdatedAt: '2026-01-01T00:00:00Z', status: 'stale' } }),
    ]

    const { freshest, stalest } = computeFreshestStalest(datasets)

    expect(freshest?.id).toBe('newest')
    expect(stalest?.id).toBe('oldest')
  })

  it('returns null for both when the list is empty', () => {
    expect(computeFreshestStalest([])).toEqual({ freshest: null, stalest: null })
  })

  it('returns the same dataset for both freshest and stalest when there is only one', () => {
    const only = dataset({ id: 'only' })
    const { freshest, stalest } = computeFreshestStalest([only])
    expect(freshest?.id).toBe('only')
    expect(stalest?.id).toBe('only')
  })
})
