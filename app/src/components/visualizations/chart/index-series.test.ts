import { describe, expect, it } from 'vitest'
import { indexSeries } from './index-series'

describe('indexSeries', () => {
  it('puts every series at 100 at its first value', () => {
    const out = indexSeries([{ x: 'a', p: 50, q: 400 }, { x: 'b', p: 75, q: 300 }], 'x', ['p', 'q'])

    expect(out[0]).toMatchObject({ p: 100, q: 100 })
  })

  it('expresses later values as a percentage of the first', () => {
    const out = indexSeries([{ x: 'a', p: 50 }, { x: 'b', p: 75 }], 'x', ['p'])

    expect(out[1].p).toBe(150)
  })

  it('puts two series of wildly different magnitude on one readable scale', () => {
    // This is the whole point: 3 and 3_000_000 are incomparable raw, and
    // identical once indexed.
    const out = indexSeries([{ x: 'a', p: 3, q: 3_000_000 }, { x: 'b', p: 6, q: 6_000_000 }], 'x', ['p', 'q'])

    expect(out[1].p).toBe(200)
    expect(out[1].q).toBe(200)
  })

  it('takes the first non-zero value as the base, so a series starting at zero still indexes', () => {
    const out = indexSeries([{ x: 'a', p: 0 }, { x: 'b', p: 4 }, { x: 'c', p: 8 }], 'x', ['p'])

    expect(out[0].p).toBe(0)
    expect(out[1].p).toBe(100)
    expect(out[2].p).toBe(200)
  })

  it('nulls a series that has no non-zero value, rather than leaving it unindexed', () => {
    // Leaving it raw would put an unindexed series on an indexed axis, which
    // is the lie this whole phase exists to remove.
    const out = indexSeries([{ x: 'a', p: 0 }, { x: 'b', p: 0 }], 'x', ['p'])

    expect(out[0].p).toBeNull()
    expect(out[1].p).toBeNull()
  })

  it('leaves a gap as a gap', () => {
    const out = indexSeries([{ x: 'a', p: 10 }, { x: 'b', p: null }, { x: 'c', p: 20 }], 'x', ['p'])

    expect(out[1].p).toBeNull()
    expect(out[2].p).toBe(200)
  })

  it('leaves the x column alone', () => {
    const out = indexSeries([{ x: 'a', p: 10 }], 'x', ['p'])

    expect(out[0].x).toBe('a')
  })

  it('leaves a column not in seriesNames untouched, indexing only the named series', () => {
    const out = indexSeries([{ x: 'a', p: 50, note: 'first' }, { x: 'b', p: 75, note: 'second' }], 'x', ['p'])

    expect(out[0].note).toBe('first')
    expect(out[1].note).toBe('second')
  })

  it('preserves direction for a negative-start series that rises, dividing by the base magnitude', () => {
    // An ordinary profit-and-loss shape: rises monotonically from a deficit.
    // Dividing by the signed base would invert this (see the module comment);
    // dividing by its magnitude keeps the indexed sequence rising too.
    const out = indexSeries([{ x: 'a', p: -50 }, { x: 'b', p: -25 }, { x: 'c', p: 50 }], 'x', ['p'])

    expect(out[0].p).toBe(-100)
    expect(out[1].p).toBe(-50)
    expect(out[2].p).toBe(100)
    expect(Number(out[0].p)).toBeLessThan(Number(out[1].p))
    expect(Number(out[1].p)).toBeLessThan(Number(out[2].p))
  })

  it('preserves direction for a negative-start series that falls', () => {
    const out = indexSeries([{ x: 'a', p: -20 }, { x: 'b', p: -40 }, { x: 'c', p: -80 }], 'x', ['p'])

    expect(out[0].p).toBe(-100)
    expect(out[1].p).toBe(-200)
    expect(out[2].p).toBe(-400)
    expect(Number(out[0].p)).toBeGreaterThan(Number(out[1].p))
    expect(Number(out[1].p)).toBeGreaterThan(Number(out[2].p))
  })

  it('preserves sign when a series crosses zero in both directions', () => {
    const out = indexSeries(
      [{ x: 'a', p: 10 }, { x: 'b', p: -5 }, { x: 'c', p: 20 }, { x: 'd', p: -10 }],
      'x',
      ['p'],
    )

    expect(out[0].p).toBe(100)
    expect(out[1].p).toBe(-50)
    expect(out[2].p).toBe(200)
    expect(out[3].p).toBe(-100)
  })
})
