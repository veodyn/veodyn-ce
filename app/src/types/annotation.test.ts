import { describe, expect, it } from 'vitest'
import { mockAnnotations, mockDashboards } from '@/lib/mock-data'
import type { Annotation } from '@/types/annotation'

describe('annotation fixtures', () => {
  it('exposes a non-empty set with the full contract shape', () => {
    expect(mockAnnotations.length).toBeGreaterThan(0)
    for (const a of mockAnnotations as Annotation[]) {
      expect(typeof a.id).toBe('number')
      expect(typeof a.dashboard_id).toBe('number')
      expect(a.widget_id === null || typeof a.widget_id === 'number').toBe(true)
      expect(typeof a.start).toBe('string')
      expect(new Date(a.start).toString()).not.toBe('Invalid Date')
      expect(a.end === null || typeof a.end === 'string').toBe(true)
      if (a.end !== null) {
        expect(new Date(a.end).toString()).not.toBe('Invalid Date')
      }
      expect(typeof a.label).toBe('string')
      expect(a.label.length).toBeGreaterThan(0)
      expect(typeof a.source).toBe('string')
      expect(a.source.length).toBeGreaterThan(0)
      expect(typeof a.created_at).toBe('string')
    }
  })

  it('gives every annotation a unique id', () => {
    const ids = mockAnnotations.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('targets at least one real dashboard id', () => {
    const dashboardIds = new Set(mockDashboards.map((d) => d.id))
    expect(mockAnnotations.some((a) => dashboardIds.has(a.dashboard_id))).toBe(true)
  })

  it('includes at least one point annotation and one range annotation', () => {
    expect(mockAnnotations.some((a) => a.end === null)).toBe(true)
    expect(mockAnnotations.some((a) => a.end !== null)).toBe(true)
  })
})
