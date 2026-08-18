// The contract: every chart shape Redash can store either draws a faithful
// mark or says out loud that it does not. ChartRenderer `default:`s to line, so
// an unaccounted-for type would silently draw as a line chart.
import { describe, expect, it } from 'vitest'
import type { RedashChartOptions } from '@/services/redash/visualization-options'
import { REDASH_GLOBAL_SERIES_TYPES } from '@/services/redash/visualization-options'
import { missingMappedColumns } from '@/lib/visualizations/validate-columns'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { chartShapeProblems, resolveChartShape } from './chart-shape'
import { resolveChartConfig } from './resolve-config'

/**
 * The chart-shape list this file is authoritative for, imported from
 * `REDASH_GLOBAL_SERIES_TYPES` (services/redash/visualization-options.ts), the
 * same array `RedashChartOptions['globalSeriesType']` derives from: add a type
 * there without a home in FAITHFUL or MUST_REPORT and the completeness test
 * below fails. `custom` is not in it, because it rendered author-supplied JS
 * this app never ran.
 */
const KNOWN_CHART_TYPES: readonly string[] = REDASH_GLOBAL_SERIES_TYPES

/** Drawn faithfully: the reader sees the chart that was stored. */
const FAITHFUL: Record<string, string> = {
  line: 'line',
  area: 'area',
  pie: 'pie',
  scatter: 'scatter',
  // Redash's name for a vertical bar chart, and the type it writes when nobody
  // touches the dropdown.
  column: 'bar',
  // A bubble is a scatter carrying a size channel: the marks from <Scatter>, the
  // size from a <ZAxis> bound to Redash's `size` slot. Listing it here is a claim
  // about the RENDERER, which the two bubble cases at the bottom keep honest.
  bubble: 'scatter',
  // This app's own spelling, not Redash's: AI-authored and default-visualization
  // paths write `bar` directly rather than through the `column` alias above.
  bar: 'bar',
}

/** Not drawn faithfully, and required to say so rather than fall back quietly. */
const MUST_REPORT = ['heatmap', 'box']

const options = (globalSeriesType: string): RedashChartOptions =>
  ({ globalSeriesType }) as RedashChartOptions

describe('chart shape contract', () => {
  // Guards against the pinned list itself going stale or being emptied by
  // accident, which would make the coverage assertion below vacuously true.
  it('pins the committed chart-type list', () => {
    expect(KNOWN_CHART_TYPES).toContain('column')
    // 9: the eight Redash's own chart editor can write, plus this app's `bar`.
    expect(KNOWN_CHART_TYPES.length).toBe(9)
    expect(KNOWN_CHART_TYPES).toContain('bar')
    expect(KNOWN_CHART_TYPES).not.toContain('custom')
  })

  it('covers every type this app is authoritative for, so a ninth cannot slip through unnoticed', () => {
    expect([...Object.keys(FAITHFUL), ...MUST_REPORT].sort()).toEqual([...KNOWN_CHART_TYPES].sort())
  })

  it.each(Object.entries(FAITHFUL))('draws %s as %s', (stored, shape) => {
    expect(resolveChartShape(stored)).toBe(shape)
    expect(chartShapeProblems(options(stored))).toEqual([])
  })

  // An unsupported type must report, not draw a line chart and say nothing.
  it.each(MUST_REPORT)('says out loud that it cannot draw %s', (stored) => {
    const problems = chartShapeProblems(options(stored))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(stored)
  })

  // Both bubble states, because the old warning was conditional on a size
  // column being mapped: an implementation that inverted that condition instead
  // of removing it would satisfy every other assertion in this file.
  it('reports nothing for a bubble whether or not a size column is mapped', () => {
    const sized = {
      globalSeriesType: 'bubble',
      columnMapping: { at: 'x', value: 'y', weight: 'size' },
    } as RedashChartOptions
    const unsized = {
      globalSeriesType: 'bubble',
      columnMapping: { at: 'x', value: 'y' },
    } as RedashChartOptions

    expect(chartShapeProblems(sized)).toEqual([])
    expect(chartShapeProblems(unsized)).toEqual([])
    expect(chartShapeProblems(options('bubble'))).toEqual([])
  })

  // Half of "the size channel is really drawn": the mapped column survives
  // config resolution and reaches the renderer as `sizeCol`.
  // scatter-chart.bubble.test.tsx pins the other half, the differently sized marks.
  it('hands a mapped size column to the renderer instead of dropping it', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'at', friendly_name: 'At', type: 'integer' },
        { name: 'value', friendly_name: 'Value', type: 'integer' },
        { name: 'weight', friendly_name: 'Weight', type: 'integer' },
      ],
      rows: [{ at: 1, value: 10, weight: 3 }],
    }
    const visualization = {
      id: 1,
      type: 'CHART',
      name: 'Bubble',
      description: '',
      options: { globalSeriesType: 'bubble', columnMapping: { at: 'x', value: 'y', weight: 'size' } },
      created_at: '2026-07-21T00:00:00Z',
      updated_at: '2026-07-21T00:00:00Z',
    } as MockVisualization

    expect(resolveChartConfig(visualization, data).sizeCol).toBe('weight')
  })

  // Which validator owns a stale size column, pinned so it cannot end up owned
  // by both. Answering it needs the query result, which chartShapeProblems does
  // not get, so `size` sits in the shared role set and the CHART plugin runs both.
  it('leaves a stale size column to the shared column validator', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'at', friendly_name: 'At', type: 'integer' },
        { name: 'value', friendly_name: 'Value', type: 'integer' },
      ],
      rows: [{ at: 1, value: 10 }],
    }
    const columnMapping = { at: 'x', value: 'y', old_weight: 'size' }
    const visualization = {
      id: 1,
      type: 'CHART',
      name: 'Bubble',
      description: '',
      options: { globalSeriesType: 'bubble', columnMapping },
      created_at: '2026-07-21T00:00:00Z',
      updated_at: '2026-07-21T00:00:00Z',
    } as MockVisualization

    expect(chartShapeProblems({ globalSeriesType: 'bubble', columnMapping } as RedashChartOptions)).toEqual([])
    expect(missingMappedColumns({ columnMapping }, data)).toEqual([
      'The size column "old_weight" is not in this query result.',
    ])
    // And the drawing matches the note rather than pointing a size axis at a
    // key no row carries.
    expect(resolveChartConfig(visualization, data).sizeCol).toBeUndefined()
  })

  // Unset and empty both mean "nobody chose". The empty string is reachable
  // because options is untyped JSON on the wire, and reporting it as an unknown
  // type would warn above every chart that never set the option.
  it('leaves an unset or empty type as a line, which is the historical default', () => {
    expect(resolveChartShape(undefined)).toBe('line')
    expect(resolveChartShape('')).toBe('line')
    expect(chartShapeProblems({} as RedashChartOptions)).toEqual([])
    expect(chartShapeProblems(options(''))).toEqual([])
  })

  // A type nobody has heard of is not the same as one we chose to defer. It
  // still must not pass as a line chart drawn on purpose.
  it('reports a type from neither list instead of silently drawing it', () => {
    expect(resolveChartShape('treemap')).toBe('line')
    expect(chartShapeProblems(options('treemap'))).toHaveLength(1)
  })

  // `bar` must stay faithful on its own: if the alias table loses `column`, the
  // it.each above fails rather than this.
  it('keeps this app own bar spelling working alongside the alias', () => {
    expect(resolveChartShape('bar')).toBe('bar')
    expect(chartShapeProblems(options('bar'))).toEqual([])
  })
})
