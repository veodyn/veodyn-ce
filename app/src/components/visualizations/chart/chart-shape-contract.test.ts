// Every chart shape Redash can store has to be accounted for here.
//
// The defect this guards: ChartRenderer switches on a handful of values and
// `default:`s to line, and nothing normalized the option on the way in. Redash's
// default is `column`, so a bar chart authored in Redash's own UI drew here as a
// line, silently, and had done since the renderer was written. `bubble`, `box`
// and `heatmap` did the same.
//
// A silent fallback is the whole bug, so the contract is: every value Redash can
// write either draws a faithful mark, or says out loud that it does not. Nothing
// may quietly become a line chart.
import { describe, expect, it } from 'vitest'
import type { RedashChartOptions } from '@/services/redash/visualization-options'
import { REDASH_GLOBAL_SERIES_TYPES } from '@/services/redash/visualization-options'
import { missingMappedColumns } from '@/lib/visualizations/validate-columns'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { chartShapeProblems, resolveChartShape } from './chart-shape'
import { resolveChartConfig } from './resolve-config'

/**
 * The chart-shape list this file is authoritative for.
 *
 * Until viz-lib was deleted, this list was READ FROM THE FORK: Redash's own
 * `ChartTypeSelect.tsx` was a second opinion, parsed off disk at test time, and
 * disagreeing with it was the entire point of this contract. `viz-lib/`
 * no longer exists in this repo, so there is no fork left to read.
 *
 * The list below is no longer a second hand-kept copy of its own: it is
 * imported straight from `REDASH_GLOBAL_SERIES_TYPES`
 * (`services/redash/visualization-options.ts`), the same array
 * `RedashChartOptions['globalSeriesType']` is derived from. That was the gap
 * an earlier version of this file had: three lists kept inside this one test
 * (KNOWN_CHART_TYPES, FAITHFUL, MUST_REPORT) agreed with each other while the
 * real wire type had already grown a ninth value (`bar`, this app's own
 * spelling, not Redash's), and the completeness assertion below stayed green
 * regardless. Importing the real source closes that: add a type to
 * REDASH_GLOBAL_SERIES_TYPES without also giving it a home in FAITHFUL or
 * MUST_REPORT below, and the completeness test fails.
 *
 * `custom` is excluded on purpose: it was gated behind
 * visualizationsSettings.allowCustomJSVisualizations and rendered arbitrary
 * author-supplied JS, which this app never ran, so it was never added to
 * REDASH_GLOBAL_SERIES_TYPES either.
 */
const KNOWN_CHART_TYPES: readonly string[] = REDASH_GLOBAL_SERIES_TYPES

/** Drawn faithfully: the reader sees the chart that was stored. */
const FAITHFUL: Record<string, string> = {
  line: 'line',
  area: 'area',
  pie: 'pie',
  scatter: 'scatter',
  // Redash's name for a vertical bar chart, and the type it writes when nobody
  // touches the dropdown. This one alias is most of the user-visible bug.
  column: 'bar',
  // A bubble is a scatter carrying a size channel, and both halves are drawn
  // now: the marks by ScatterChart's <Scatter>, the size by a <ZAxis> bound to
  // the column in Redash's `size` slot. It sat outside this table until that
  // axis existed, warning whenever a size column was mapped. Moving it in is a
  // claim about the RENDERER, not just about this file's tables, which is what
  // the two bubble cases at the bottom are here to keep honest.
  bubble: 'scatter',
  // This app's own spelling, not Redash's: AI-authored and default-visualization
  // paths write `bar` directly rather than going through the `column` alias
  // above. It is a legitimate ninth member of REDASH_GLOBAL_SERIES_TYPES, not
  // an omission; the dedicated test below ("keeps this app own bar spelling
  // working alongside the alias") pins it as well.
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
    // 9: the eight Redash's own chart editor can write, plus this app's own
    // `bar` spelling. See REDASH_GLOBAL_SERIES_TYPES's own comment for why
    // `bar` belongs here rather than being an app-only afterthought.
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

  // The heart of it. Before this, all three drew a line chart and said nothing,
  // which reads as a real answer rather than as an unsupported type.
  it.each(MUST_REPORT)('says out loud that it cannot draw %s', (stored) => {
    const problems = chartShapeProblems(options(stored))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(stored)
  })

  // Both bubble states, in one case, because the old behaviour was a CONDITION
  // rather than a blanket warning: a bubble with no size column never warned,
  // and one with a size column always did. An implementation that inverted that
  // condition instead of removing it would still satisfy every other assertion
  // in this file, so both sides are pinned.
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

  // Retiring the warning is only honest if the size channel is really drawn,
  // and nothing above can see a mark. This pins the first half of that: the
  // mapped column survives config resolution and reaches the renderer as
  // `sizeCol`, rather than being read and dropped. scatter-chart.bubble.test.tsx
  // pins the second half, that the renderer turns it into differently sized
  // marks. Without the pair, moving bubble into FAITHFUL would look exactly
  // like deleting a warning that was still true.
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
  // by both. The retired bubble warning fired on the MAPPING alone, so it could
  // not tell a size column that draws from one the query stopped returning, and
  // it drowned the second case in a note about the first. Answering it needs the
  // query result, which chartShapeProblems does not get; `size` went back into
  // the shared role set instead, and the CHART plugin already runs both.
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

  // Unset and empty both mean "nobody chose", and both predate this mapping.
  // The empty string is only reachable because options is untyped JSON on the
  // wire, which is exactly why it is worth pinning: reported as an unknown type
  // it would put a warning above every chart that never set the option.
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

  // The guard is only worth having if a regression trips it. `bar` is this
  // app's own spelling and must stay faithful; if the alias table ever loses
  // `column`, the it.each above fails rather than this.
  it('keeps this app own bar spelling working alongside the alias', () => {
    expect(resolveChartShape('bar')).toBe('bar')
    expect(chartShapeProblems(options('bar'))).toEqual([])
  })
})
