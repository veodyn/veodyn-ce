import { describe, expect, it } from 'vitest'
import { mockFeeds, mockDatasets } from '@/lib/mock-data'
import type { Feed } from '@/types/feed'

describe('feed fixtures', () => {
  it('exposes a non-empty feed set with the full contract shape', () => {
    expect(mockFeeds.length).toBeGreaterThan(0)
    for (const f of mockFeeds as Feed[]) {
      expect(typeof f.id).toBe('string')
      expect(f.id.length).toBeGreaterThan(0)
      expect(typeof f.name).toBe('string')
      expect(typeof f.source).toBe('string')
      expect(typeof f.cadence).toBe('string')
      expect(typeof f.lastReceivedAt).toBe('string')
      expect(['fresh', 'stale', 'down']).toContain(f.status)
      expect(typeof f.datasetCount).toBe('number')
    }
  })

  it('gives every feed a unique id', () => {
    const ids = mockFeeds.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('links at least one feed to a real dataset freshness.feedId', () => {
    const feedIds = new Set(mockFeeds.map((f) => f.id))
    const datasetFeedIds = mockDatasets.map((d) => d.freshness.feedId).filter(Boolean) as string[]
    expect(datasetFeedIds.some((fid) => feedIds.has(fid))).toBe(true)
  })

  it('exercises a non-fresh status so the stale/down path renders', () => {
    expect(mockFeeds.some((f) => f.status !== 'fresh')).toBe(true)
  })
})
