import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import type { ResolvedChartConfig } from './resolve-config'
import { buildChartData } from './transform-data'

const baseConfig: ResolvedChartConfig = {
  chartType: 'bar',
  xCol: 'x',
  yRightCols: [],
  effectiveYCols: ['value'],
  indexed: false,
  stacking: 'disabled',
  xIsDatetime: false,
  xHasTime: false,
  swappedAxes: false,
  reverseX: false,
  showDataLabels: false,
  donut: false,
  seriesOptions: {},
  yAxis: [],
  referenceLines: [],
}

function dataWithRows(rows: Record<string, unknown>[]): QueryResultData {
  return { columns: [], rows }
}

describe('buildChartData', () => {
  it('passes rows through when no series column or other transform is configured', () => {
    const rows = [
      { x: 'q1', value: 10 },
      { x: 'q2', value: 20 },
    ]

    const output = buildChartData(dataWithRows(rows), baseConfig)

    expect(output).toBe(rows)
  })

  it('pivots series rows into one object per x value', () => {
    const data = dataWithRows([
      { x: 'q1', region: 'North', value: 10 },
      { x: 'q1', region: 'South', value: 20 },
      { x: 'q2', region: 'North', value: 30 },
      { x: 'q2', region: 'South', value: 40 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      seriesCol: 'region',
    }

    expect(buildChartData(data, config)).toEqual([
      { x: 'q1', North: 10, South: 20 },
      { x: 'q2', North: 30, South: 40 },
    ])
  })

  it('sorts rows chronologically when x is datetime', () => {
    const data = dataWithRows([
      { x: '2026-07-21T12:00:00', value: 3 },
      { x: '2026-07-19T12:00:00', value: 1 },
      { x: '2026-07-20T12:00:00', value: 2 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      xIsDatetime: true,
      xHasTime: true,
    }

    expect(buildChartData(data, config)).toEqual([
      { x: '2026-07-19T12:00:00', value: 1 },
      { x: '2026-07-20T12:00:00', value: 2 },
      { x: '2026-07-21T12:00:00', value: 3 },
    ])
  })

  it('reverses the x order when reverseX is enabled', () => {
    const data = dataWithRows([
      { x: 'first', value: 1 },
      { x: 'second', value: 2 },
      { x: 'third', value: 3 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      reverseX: true,
    }

    expect(buildChartData(data, config)).toEqual([
      { x: 'third', value: 3 },
      { x: 'second', value: 2 },
      { x: 'first', value: 1 },
    ])
  })

  it('normalizes percent-stacked values to 100 and leaves a zero-total group untouched', () => {
    const zeroTotalRow = { x: 'q2', a: 0, b: 0 }
    const data = dataWithRows([
      { x: 'q1', a: 1, b: 3 },
      zeroTotalRow,
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      effectiveYCols: ['a', 'b'],
      stacking: 'percent',
    }

    const output = buildChartData(data, config)

    expect(output[0]).toEqual({ x: 'q1', a: 25, b: 75 })
    expect(Number(output[0].a) + Number(output[0].b)).toBe(100)
    expect(output[1]).toBe(zeroTotalRow)
  })

  it('indexes every series to 100 at its first value when indexed is set', () => {
    const data = dataWithRows([
      { x: 'q1', a: 10, b: 1_000 },
      { x: 'q2', a: 20, b: 2_000 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      effectiveYCols: ['a', 'b'],
      indexed: true,
    }

    const output = buildChartData(data, config)

    expect(output[0]).toEqual({ x: 'q1', a: 100, b: 100 })
    expect(output[1]).toEqual({ x: 'q2', a: 200, b: 200 })
  })

  it('bases the index on the first value in plotted order, after reverseX runs', () => {
    // Raw row order is q1, q2, q3; reverseX flips that to q3, q2, q1 for
    // display. The base has to be q3's value (the leftmost point once
    // reversed), not q1's (the first row of the raw result).
    const data = dataWithRows([
      { x: 'q1', a: 10 },
      { x: 'q2', a: 20 },
      { x: 'q3', a: 40 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      effectiveYCols: ['a'],
      reverseX: true,
      indexed: true,
    }

    const output = buildChartData(data, config)

    expect(output).toEqual([
      { x: 'q3', a: 100 },
      { x: 'q2', a: 50 },
      { x: 'q1', a: 25 },
    ])
  })

  it('indexes yRightCols alongside the left-axis series, matching the real saved shape (temp_f mapped to y, humidity mapped to yRight)', () => {
    // src/lib/mock-data/packs/neutral/dashboards.ts has a saved chart with
    // exactly this shape. Before this fix, buildChartData indexed only
    // seriesNamesFor(config, data) (effectiveYCols), so humidity was drawn
    // raw on the same axis labelled "indexed" as temp: mixed units on one
    // scale, worse than the dual-axis rendering this phase replaced.
    const data = dataWithRows([
      { x: 'q1', temp: 10, humidity: 10_000 },
      { x: 'q2', temp: 20, humidity: 20_000 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      effectiveYCols: ['temp'],
      yRightCols: ['humidity'],
      indexed: true,
    }

    const output = buildChartData(data, config)

    expect(output[0]).toEqual({ x: 'q1', temp: 100, humidity: 100 })
    expect(output[1]).toEqual({ x: 'q2', temp: 200, humidity: 200 })
  })

  it('carries a yRight column through the series-column pivot, so a series column plus a right-axis column both render', () => {
    // Review defect (found during round A, independent of indexing): the
    // seriesCol pivot branch copied only config.effectiveYCols into the
    // pivoted group, never config.yRightCols, so a chart mapping both a
    // series column and a right-axis column drew the right-axis series
    // entirely blank. Reachable through saved JSON regardless of what the
    // editor currently offers.
    //
    // Both regions carry the SAME forecast value at each x here (100, then
    // 200), which is exactly what let the first fix for this ship with a
    // hidden defect: `group[yRightCol] = row[yRightCol]` overwrites the same
    // key for every row sharing that x, so whichever region's row happened to
    // be written last silently won. That is invisible when every candidate
    // value agrees, which is why the case with genuinely different values
    // per region is its own separate test below.
    const data = dataWithRows([
      { x: 'q1', region: 'North', value: 10, forecast: 100 },
      { x: 'q1', region: 'South', value: 20, forecast: 100 },
      { x: 'q2', region: 'North', value: 30, forecast: 200 },
      { x: 'q2', region: 'South', value: 40, forecast: 200 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      seriesCol: 'region',
      yRightCols: ['forecast'],
    }

    expect(buildChartData(data, config)).toEqual([
      { x: 'q1', North: 10, South: 20, 'forecast (North)': 100, 'forecast (South)': 100 },
      { x: 'q2', North: 30, South: 40, 'forecast (North)': 200, 'forecast (South)': 200 },
    ])
  })

  it('keeps a right-axis column honest when its value genuinely differs per series at the same x, instead of letting whichever row is written last win', () => {
    // Review defect: `group[yRightCol] = row[yRightCol]` is a single shared
    // slot overwritten by every row sharing that x. The masked version of
    // this test (above) uses the SAME forecast value for both regions, so
    // the overwrite is invisible. Here North and South carry genuinely
    // different forecast values at q1 (100 vs 900) and q2 (200 vs 800): an
    // implementation that just overwrites one shared key would silently drop
    // one region's forecast and draw the other's under a name that claims to
    // be a single, unambiguous series. Each (series, right column) pair gets
    // its own key instead, so what's drawn always traces back to real rows.
    const data = dataWithRows([
      { x: 'q1', region: 'North', value: 10, forecast: 100 },
      { x: 'q1', region: 'South', value: 20, forecast: 900 },
      { x: 'q2', region: 'North', value: 30, forecast: 200 },
      { x: 'q2', region: 'South', value: 40, forecast: 800 },
    ])
    const config: ResolvedChartConfig = {
      ...baseConfig,
      seriesCol: 'region',
      yRightCols: ['forecast'],
    }

    expect(buildChartData(data, config)).toEqual([
      { x: 'q1', North: 10, South: 20, 'forecast (North)': 100, 'forecast (South)': 900 },
      { x: 'q2', North: 30, South: 40, 'forecast (North)': 200, 'forecast (South)': 800 },
    ])
  })

  // Stacking forcing indexing off used to be checked here as well as in
  // resolveChartConfig, and the two could disagree: an indexed chart with
  // stacking on drew raw, summed magnitudes under an indexed axis label.
  // "is this chart actually indexed" is now decided once, in
  // resolveChartConfig (see resolve-config.test.ts, "turns indexed off when
  // stacking is on..."), so config.indexed arriving here already reflects
  // stacking and buildChartData does not recheck it.
})
