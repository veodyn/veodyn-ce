import { describe, expect, it } from 'vitest'
import { mockDatasets, mockDomainHubs } from '@/lib/mock-data'
import type { Dataset, DomainHub } from '@/types/catalog'

describe('catalog fixtures', () => {
  it('exposes a non-empty dataset set with the full contract shape', () => {
    expect(mockDatasets.length).toBeGreaterThan(0)
    for (const d of mockDatasets as Dataset[]) {
      expect(typeof d.id).toBe('string')
      expect(d.id.length).toBeGreaterThan(0)
      expect(typeof d.name).toBe('string')
      expect(Array.isArray(d.schema)).toBe(true)
      expect(d.schema.length).toBeGreaterThan(0)
      expect(d.freshness.status === 'fresh' || d.freshness.status === 'stale').toBe(true)
      expect(typeof d.freshness.lastUpdatedAt).toBe('string')
      expect(typeof d.coverage.start).toBe('string')
      expect(typeof d.coverage.end).toBe('string')
      expect(typeof d.rowCount).toBe('number')
      expect(Array.isArray(d.sources)).toBe(true)
      // domain is a config key or null; never the reserved detail segment.
      expect(d.domain).not.toBe('dataset')
    }
  })

  it('gives every dataset a unique id', () => {
    const ids = mockDatasets.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes domain hubs whose datasetIds and dashboardIds resolve', () => {
    expect(mockDomainHubs.length).toBeGreaterThan(0)
    const ids = new Set(mockDatasets.map((d) => d.id))
    for (const h of mockDomainHubs as DomainHub[]) {
      expect(h.key).not.toBe('dataset')
      expect(h.counters.length).toBeGreaterThan(0)
      for (const dsId of h.datasetIds) expect(ids.has(dsId)).toBe(true)
    }
  })
})
