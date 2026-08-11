import { describe, expect, it } from 'vitest'
import { downsampleRows, MAX_PLOTTED_ROWS } from './downsample'

function series(values: number[], name = 'speed'): Record<string, unknown>[] {
  return values.map((value, index) => ({ at: index, [name]: value }))
}

describe('downsampleRows', () => {
  it('returns the very same array when there is nothing to reduce', () => {
    const rows = series([1, 2, 3])

    // Identity, not just equality: the common case must allocate nothing.
    expect(downsampleRows(rows, ['speed'], 10)).toBe(rows)
  })

  it('reduces a long series to the budget', () => {
    const rows = series(Array.from({ length: 5_000 }, (_, i) => i % 17))

    expect(downsampleRows(rows, ['speed'], 100).length).toBeLessThanOrEqual(100)
  })

  it('draws only rows the query really returned', () => {
    // The rule that makes this a selection and not an aggregation. A bucketed
    // mean would put a number on the chart that came from nowhere.
    const rows = series(Array.from({ length: 2_000 }, (_, i) => i * 3))
    const source = new Set(rows.map((row) => row.speed))

    for (const row of downsampleRows(rows, ['speed'], 50)) {
      expect(source.has(row.speed)).toBe(true)
    }
  })

  it('keeps the row holding a one-sample spike', () => {
    // The whole point. A reduction that drops a spike does not simplify the
    // chart, it deletes the event, and the reader cannot tell it happened.
    const values = Array.from({ length: 4_000 }, () => 5)
    values[1_234] = 99

    const kept = downsampleRows(series(values), ['speed'], 40)

    expect(kept.some((row) => row.speed === 99)).toBe(true)
  })

  it('keeps the row holding a one-sample trough', () => {
    const values = Array.from({ length: 4_000 }, () => 5)
    values[2_345] = -99

    const kept = downsampleRows(series(values), ['speed'], 40)

    expect(kept.some((row) => row.speed === -99)).toBe(true)
  })

  it('keeps every series own peak, not just the loudest one', () => {
    // A chart that keeps only the overall maximum flattens every series but
    // one, which is exactly the failure the six-line chart already has.
    const rows = Array.from({ length: 3_000 }, (_, index) => ({
      at: index,
      loud: index === 100 ? 1_000 : 500,
      quiet: index === 2_000 ? 9 : 1,
    }))

    const kept = downsampleRows(rows, ['loud', 'quiet'], 30)

    expect(kept.some((row) => row.loud === 1_000)).toBe(true)
    expect(kept.some((row) => row.quiet === 9)).toBe(true)
  })

  it('keeps both ends, so the line still spans its axis', () => {
    const rows = series(Array.from({ length: 1_000 }, (_, i) => i % 7))

    const kept = downsampleRows(rows, ['speed'], 20)

    expect(kept[0]).toBe(rows[0])
    expect(kept.at(-1)).toBe(rows.at(-1))
  })

  it('keeps the rows in the order they arrived', () => {
    const rows = series(Array.from({ length: 1_000 }, (_, i) => (i * 7) % 31))

    const kept = downsampleRows(rows, ['speed'], 25)
    const positions = kept.map((row) => row.at as number)

    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('never repeats a row', () => {
    const rows = series(Array.from({ length: 1_000 }, (_, i) => i))

    const kept = downsampleRows(rows, ['speed'], 30)

    expect(new Set(kept).size).toBe(kept.length)
  })

  it('ignores a non-numeric cell rather than ranking it', () => {
    const rows: Record<string, unknown>[] = Array.from({ length: 1_000 }, (_, index) => ({
      at: index,
      speed: index === 500 ? 'n/a' : 3,
    }))
    rows[600] = { at: 600, speed: 42 }

    const kept = downsampleRows(rows, ['speed'], 20)

    expect(kept.some((row) => row.speed === 42)).toBe(true)
  })

  it('lets the spikes win when they alone exceed the budget', () => {
    // Deliberate: this is a readability measure, not a hard cap. Dropping a
    // real peak to satisfy a number would be the one thing it exists to avoid.
    const names = Array.from({ length: 30 }, (_, i) => `s${i}`)
    const rows = Array.from({ length: 2_000 }, (_, index) => {
      const row: Record<string, unknown> = { at: index }
      for (const [n, name] of names.entries()) row[name] = index === n * 10 ? 100 : 1
      return row
    })

    const kept = downsampleRows(rows, names, 5)

    expect(kept.length).toBeGreaterThan(5)
    for (const [n] of names.entries()) {
      expect(kept.some((row) => row.at === n * 10)).toBe(true)
    }
  })

  it('has a default budget of about one point per pixel of a wide plot', () => {
    expect(MAX_PLOTTED_ROWS).toBeGreaterThan(400)
    expect(MAX_PLOTTED_ROWS).toBeLessThan(2_000)
  })
})
