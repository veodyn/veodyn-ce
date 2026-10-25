import { describe, expect, it } from 'vitest'
import { applyOptionOps } from './ops'

describe('applyOptionOps', () => {
  it('sets a top-level key without touching the input', () => {
    const input = { globalSeriesType: 'line', columnMapping: { a: 'x' } }
    const out = applyOptionOps(input, { set: [{ path: 'globalSeriesType', value: 'bar' }] })
    expect(out).toEqual({ globalSeriesType: 'bar', columnMapping: { a: 'x' } })
    expect(input).toEqual({ globalSeriesType: 'line', columnMapping: { a: 'x' } })
    expect(out.columnMapping).toBe(input.columnMapping)
  })

  it('sets a nested key and keeps its siblings', () => {
    const out = applyOptionOps({ columnMapping: { a: 'x' } }, { set: [{ path: 'columnMapping.speed', value: 'y' }] })
    expect(out).toEqual({ columnMapping: { a: 'x', speed: 'y' } })
  })

  it('creates intermediate objects', () => {
    const out = applyOptionOps({}, { set: [{ path: 'series.stacking', value: 'stack' }] })
    expect(out).toEqual({ series: { stacking: 'stack' } })
  })

  it('creates an array when the next segment is a number', () => {
    const out = applyOptionOps({}, { set: [{ path: 'yAxis.0.rangeMin', value: 5 }] })
    expect(out).toEqual({ yAxis: [{ rangeMin: 5 }] })
    expect(Array.isArray(out.yAxis)).toBe(true)
  })

  it('edits an array entry in place and keeps the other entries', () => {
    const input = { yAxis: [{ type: 'linear', rangeMin: 1 }, { type: 'linear' }] }
    const out = applyOptionOps(input, { set: [{ path: 'yAxis.0.rangeMax', value: 9 }] })
    expect(out).toEqual({ yAxis: [{ type: 'linear', rangeMin: 1, rangeMax: 9 }, { type: 'linear' }] })
    expect(input.yAxis[0]).toEqual({ type: 'linear', rangeMin: 1 })
  })

  it('replaces a primitive sitting where a container is needed', () => {
    const out = applyOptionOps({ series: 'oops' }, { set: [{ path: 'series.stacking', value: 'stack' }] })
    expect(out).toEqual({ series: { stacking: 'stack' } })
  })

  it('applies sets in order, then unsets', () => {
    const out = applyOptionOps(
      { a: 1 },
      { set: [{ path: 'b', value: 2 }, { path: 'b', value: 3 }], unset: ['a'] }
    )
    expect(out).toEqual({ b: 3 })
  })

  it('unsets a key', () => {
    expect(applyOptionOps({ a: 1, b: 2 }, { unset: ['a'] })).toEqual({ b: 2 })
  })

  it('prunes parent objects emptied by an unset', () => {
    const out = applyOptionOps({ series: { stacking: 'stack' }, keep: true }, { unset: ['series.stacking'] })
    expect(out).toEqual({ keep: true })
  })

  it('prunes the whole chain up to the first non-empty parent', () => {
    const out = applyOptionOps({ a: { b: { c: 1 } }, d: 1 }, { unset: ['a.b.c'] })
    expect(out).toEqual({ d: 1 })
  })

  it('keeps a parent that still has other keys', () => {
    const out = applyOptionOps({ columnMapping: { a: 'x', b: 'y' } }, { unset: ['columnMapping.a'] })
    expect(out).toEqual({ columnMapping: { b: 'y' } })
  })

  it('removes an array entry rather than leaving a hole', () => {
    const out = applyOptionOps({ referenceLines: [{ value: 1 }, { value: 2 }] }, { unset: ['referenceLines.0'] })
    expect(out).toEqual({ referenceLines: [{ value: 2 }] })
  })

  it('prunes an array entry emptied by an unset', () => {
    const out = applyOptionOps({ yAxis: [{ rangeMin: 1 }], other: 1 }, { unset: ['yAxis.0.rangeMin'] })
    expect(out).toEqual({ other: 1 })
  })

  it('ignores an unset path that does not exist', () => {
    const input = { a: { b: 1 } }
    expect(applyOptionOps(input, { unset: ['a.x.y', 'zzz'] })).toEqual({ a: { b: 1 } })
  })

  it('does not follow prototype keys', () => {
    const out = applyOptionOps({}, { set: [{ path: '__proto__.polluted', value: true }, { path: 'constructor.x', value: 1 }] })
    expect(out).toEqual({})
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('ignores an empty path', () => {
    expect(applyOptionOps({ a: 1 }, { set: [{ path: '', value: 2 }], unset: [''] })).toEqual({ a: 1 })
  })

  it('returns a copy when there are no operations', () => {
    const input = { a: 1 }
    const out = applyOptionOps(input, {})
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })
})
