import { describe, expect, it } from 'vitest'
import { mockCaptures, mockDatasets } from '@/lib/mock-data'
import type { Capture } from '@/types/capture'

describe('capture fixtures', () => {
  it('exposes a non-empty capture set with the full contract shape', () => {
    expect(mockCaptures.length).toBeGreaterThan(0)
    for (const c of mockCaptures as Capture[]) {
      expect(typeof c.id).toBe('string')
      expect(c.id.length).toBeGreaterThan(0)
      expect(typeof c.name).toBe('string')
      expect(typeof c.source).toBe('string')
      expect(typeof c.cadence).toBe('string')
      expect(typeof c.lastReceivedAt).toBe('string')
      expect(['fresh', 'stale', 'down']).toContain(c.status)
      expect(typeof c.datasetCount).toBe('number')
    }
  })

  it('gives every capture a unique id', () => {
    const ids = mockCaptures.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('links at least one capture to a real dataset freshness.captureId', () => {
    const captureIds = new Set(mockCaptures.map((c) => c.id))
    const datasetCaptureIds = mockDatasets.map((d) => d.freshness.captureId).filter(Boolean) as string[]
    expect(datasetCaptureIds.some((id) => captureIds.has(id))).toBe(true)
  })

  it('exercises a non-fresh status so the stale/down path renders', () => {
    expect(mockCaptures.some((c) => c.status !== 'fresh')).toBe(true)
  })
})
