import { describe, expect, it } from 'vitest'
import { annotationsForWidget, snapToNearestX } from './annotation-overlay'
import type { Annotation } from '@/types/annotation'

describe('snapToNearestX', () => {
  it('snaps to the nearest existing x value by absolute time distance', () => {
    const result = snapToNearestX('2026-01-02T00:00:00Z', ['2026-01-01', '2026-01-03', '2026-01-05'])
    // Jan 2 is exactly a day from both Jan 1 and Jan 3, so either is a
    // correct "nearest" answer; the important behavior under test is that it
    // does not return the far value (Jan 5) or null.
    expect(['2026-01-01', '2026-01-03']).toContain(result)
  })

  it('snaps to the strictly closer candidate when distances differ', () => {
    const result = snapToNearestX('2026-01-01T18:00:00Z', ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'])
    expect(result).toBe('2026-01-02T00:00:00Z')
  })

  it('returns the exact match when the annotation lands on an x value', () => {
    const result = snapToNearestX('2026-01-03T00:00:00Z', ['2026-01-01', '2026-01-03', '2026-01-05'])
    expect(result).toBe('2026-01-03')
  })

  it('returns null when the annotation time is before the first x value', () => {
    const result = snapToNearestX('2025-12-01T00:00:00Z', ['2026-01-01', '2026-01-03', '2026-01-05'])
    expect(result).toBeNull()
  })

  it('returns null when the annotation time is after the last x value', () => {
    const result = snapToNearestX('2026-02-01T00:00:00Z', ['2026-01-01', '2026-01-03', '2026-01-05'])
    expect(result).toBeNull()
  })

  it('returns null for an empty x-value list', () => {
    expect(snapToNearestX('2026-01-01T00:00:00Z', [])).toBeNull()
  })

  it('returns null when the annotation timestamp itself does not parse', () => {
    expect(snapToNearestX('not-a-date', ['2026-01-01', '2026-01-03'])).toBeNull()
  })
})

describe('annotationsForWidget', () => {
  const xValues = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']

  function annotation(overrides: Partial<Annotation>): Annotation {
    return {
      id: 1,
      dashboard_id: 1,
      widget_id: null,
      start: '2026-01-02T00:00:00Z',
      end: null,
      label: 'test annotation',
      source: 'manual',
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  it('includes annotations pinned to this widget', () => {
    const result = annotationsForWidget([annotation({ id: 1, widget_id: 42 })], 42, xValues)
    expect(result).toEqual([{ id: 1, label: 'test annotation', x: '2026-01-02', x2: null }])
  })

  it('includes annotations targeting all widgets (widget_id null)', () => {
    const result = annotationsForWidget([annotation({ id: 2, widget_id: null })], 42, xValues)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(2)
  })

  it('excludes annotations pinned to a different widget', () => {
    const result = annotationsForWidget([annotation({ id: 3, widget_id: 99 })], 42, xValues)
    expect(result).toEqual([])
  })

  it('maps a range annotation to x and x2', () => {
    const result = annotationsForWidget(
      [
        annotation({
          id: 4,
          widget_id: 42,
          start: '2026-01-01T20:00:00Z',
          end: '2026-01-04T20:00:00Z',
        }),
      ],
      42,
      xValues,
    )
    expect(result).toEqual([{ id: 4, label: 'test annotation', x: '2026-01-02', x2: '2026-01-05' }])
  })

  it('drops annotations whose start falls outside the widget x-range', () => {
    const result = annotationsForWidget(
      [annotation({ id: 5, widget_id: 42, start: '2027-01-01T00:00:00Z' })],
      42,
      xValues,
    )
    expect(result).toEqual([])
  })

  it('drops a range annotation entirely when its end falls outside the widget x-range', () => {
    // start (Jan 2) is in range, but end is a year out: the whole range must
    // be dropped, not degrade into a point at x with x2: null.
    const result = annotationsForWidget(
      [
        annotation({
          id: 6,
          widget_id: 42,
          start: '2026-01-02T00:00:00Z',
          end: '2027-06-01T00:00:00Z',
        }),
      ],
      42,
      xValues,
    )
    expect(result).toEqual([])
  })

  it('keeps a range annotation with a non-null x2 when both endpoints are in range', () => {
    const result = annotationsForWidget(
      [
        annotation({
          id: 7,
          widget_id: 42,
          start: '2026-01-01T20:00:00Z',
          end: '2026-01-04T20:00:00Z',
        }),
      ],
      42,
      xValues,
    )
    expect(result).toEqual([{ id: 7, label: 'test annotation', x: '2026-01-02', x2: '2026-01-05' }])
  })
})
