import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashChartOptions, RedashSeriesOptions } from '@/services/redash/types'
import {
  curveTypeFor,
  inferChartColumnMapping,
  resolveChartConfig,
  seriesNamesFor,
} from './resolve-config'

function visualizationWithOptions(
  options: RedashChartOptions = {},
): MockVisualization {
  return {
    id: 1,
    type: 'CHART',
    name: 'Test chart',
    description: '',
    options: { ...options },
    created_at: '2026-07-21T00:00:00Z',
    updated_at: '2026-07-21T00:00:00Z',
  }
}

// Aliases used by the indexing-migration tests below, named after what each
// constructs rather than reusing the generic helper name throughout.
const vizWithOptions = visualizationWithOptions

function vizWithSeriesOption(seriesOptions: RedashSeriesOptions): MockVisualization {
  return visualizationWithOptions({ seriesOptions: { a: seriesOptions } })
}

function vizWithColumnMapping(columnMapping: NonNullable<RedashChartOptions['columnMapping']>): MockVisualization {
  return visualizationWithOptions({ columnMapping })
}

const dateData: QueryResultData = {
  columns: [
    { name: 'day', friendly_name: 'Day', type: 'date' },
    { name: 'region', friendly_name: 'Region', type: 'string' },
    { name: 'hits', friendly_name: 'Hits', type: 'integer' },
    { name: 'rate', friendly_name: 'Rate', type: 'decimal' },
    { name: 'notes', friendly_name: 'Notes', type: 'string' },
  ],
  rows: [
    { day: '2026-07-20', region: 'North', hits: 5, rate: 0.5, notes: 'A' },
    { day: '2026-07-21', region: 'South', hits: 8, rate: 0.8, notes: 'B' },
  ],
}

// The same inference, written out as a mapping the chart editor shows and saves.
// It has to agree with resolveChartConfig above: two copies of this rule is how
// the editor came to describe a chart as unconfigured while the preview drew it.
describe('inferChartColumnMapping', () => {
  it('maps the inferred x and every inferred y, and nothing else', () => {
    expect(inferChartColumnMapping(dateData)).toEqual({ day: 'x', hits: 'y', rate: 'y' })
  })

  it('follows the x away from the only numeric column', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'trips', friendly_name: 'Trips', type: 'integer' },
        { name: 'category', friendly_name: 'Category', type: 'string' },
      ],
      rows: [{ trips: 4, category: 'bus' }],
    }

    expect(inferChartColumnMapping(data)).toEqual({ category: 'x', trips: 'y' })
  })

  // Half a mapping takes the fallback away without standing in for it, so with
  // nothing to plot this writes nothing and leaves resolveChartConfig in charge.
  it.each([
    { label: 'no numeric column', columns: [{ name: 'name', friendly_name: 'Name', type: 'string' }] },
    { label: 'no columns at all', columns: [] },
  ])('writes no mapping when there is $label', ({ columns }) => {
    expect(inferChartColumnMapping({ columns, rows: [] })).toEqual({})
  })
})

describe('resolveChartConfig', () => {
  it('defaults to a line chart, the first x column, and inferred numeric y columns', () => {
    const config = resolveChartConfig(visualizationWithOptions(), dateData)

    expect(config.chartType).toBe('line')
    expect(config.xCol).toBe('day')
    expect(config.effectiveYCols).toEqual(['hits', 'rate'])
  })

  // Taking the first column as x is only right while it leaves something to
  // plot. A query whose aggregate comes first ('SELECT count(*), category')
  // spent that one numeric column on the x axis, so the y set came out empty and
  // the chart drew an axis pair over nothing.
  it('does not spend the only numeric column on the x axis', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'trips', friendly_name: 'Trips', type: 'integer' },
        { name: 'category', friendly_name: 'Category', type: 'string' },
      ],
      rows: [{ trips: 4, category: 'bus' }],
    }
    const config = resolveChartConfig(visualizationWithOptions(), data)

    expect(config.xCol).toBe('category')
    expect(config.effectiveYCols).toEqual(['trips'])
  })

  // Nothing numeric at all: there is no arrangement that plots, so the first
  // column stays the x rather than the rule reaching for a stand-in.
  it('keeps the first column as x when no column is numeric', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'name', friendly_name: 'Name', type: 'string' },
        { name: 'note', friendly_name: 'Note', type: 'string' },
      ],
      rows: [{ name: 'a', note: 'b' }],
    }
    const config = resolveChartConfig(visualizationWithOptions(), data)

    expect(config.xCol).toBe('name')
    expect(config.effectiveYCols).toEqual([])
  })

  it('resolves x and series columns from columnMapping and excludes them from inferred y columns', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'row_number', friendly_name: 'Row', type: 'integer' },
        { name: 'recorded_at', friendly_name: 'Recorded at', type: 'datetime' },
        { name: 'series_id', friendly_name: 'Series', type: 'integer' },
        { name: 'value', friendly_name: 'Value', type: 'float' },
      ],
      rows: [],
    }
    const config = resolveChartConfig(
      visualizationWithOptions({
        columnMapping: { recorded_at: 'x', series_id: 'series' },
      }),
      data,
    )

    expect(config.xCol).toBe('recorded_at')
    expect(config.seriesCol).toBe('series_id')
    expect(config.effectiveYCols).toEqual(['row_number', 'value'])
  })

  it('excludes a column mapped to yRight from inferred y columns, so it is not rendered and counted twice', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'day', friendly_name: 'Day', type: 'date' },
        { name: 'hits', friendly_name: 'Hits', type: 'integer' },
        { name: 'rate', friendly_name: 'Rate', type: 'decimal' },
      ],
      rows: [],
    }
    const config = resolveChartConfig(
      visualizationWithOptions({
        columnMapping: { day: 'x', rate: 'yRight' },
      }),
      data,
    )

    expect(config.yRightCols).toEqual(['rate'])
    expect(config.effectiveYCols).toEqual(['hits'])
  })

  it.each([
    { type: 'date', xIsDatetime: true, xHasTime: false },
    { type: 'datetime', xIsDatetime: true, xHasTime: true },
  ])(
    'derives date flags for a $type x column',
    ({ type, xIsDatetime, xHasTime }) => {
      const data: QueryResultData = {
        columns: [
          { name: 'when', friendly_name: 'When', type },
          { name: 'value', friendly_name: 'Value', type: 'integer' },
        ],
        rows: [],
      }

      const config = resolveChartConfig(visualizationWithOptions(), data)

      expect(config.xIsDatetime).toBe(xIsDatetime)
      expect(config.xHasTime).toBe(xHasTime)
    },
  )

  it('reads timestamps out of a column the runner typed as a string', () => {
    // ClickHouse DateTime64(3) arrives as TYPE_STRING, so the declared type
    // says nothing and the values have to answer for themselves.
    const data: QueryResultData = {
      columns: [
        { name: 'when', friendly_name: 'When', type: 'string' },
        { name: 'value', friendly_name: 'Value', type: 'integer' },
      ],
      rows: [
        { when: '2026-07-22 15:22:25.919', value: 4 },
        { when: '2026-07-22 15:23:25.919', value: 6 },
      ],
    }

    const config = resolveChartConfig(visualizationWithOptions(), data)

    expect(config.xIsDatetime).toBe(true)
    expect(config.xHasTime).toBe(true)
  })

  it('leaves an ordinary string column categorical', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'when', friendly_name: 'When', type: 'string' },
        { name: 'value', friendly_name: 'Value', type: 'integer' },
      ],
      rows: [{ when: 'q1', value: 4 }],
    }

    expect(resolveChartConfig(visualizationWithOptions(), data).xIsDatetime).toBe(false)
  })

  it.each([
    { options: {}, expected: 'disabled' },
    { options: { stacking: 'stack' }, expected: 'stack' },
    { options: { series: { stacking: 'stack' } }, expected: 'stack' },
    { options: { series: { stacking: 'percent' } }, expected: 'percent' },
    { options: { series: { stacking: 'disabled' } }, expected: 'disabled' },
  ] satisfies Array<{
    options: RedashChartOptions
    expected: 'stack' | 'percent' | 'disabled'
  }>)('maps stacking options to $expected', ({ options, expected }) => {
    const config = resolveChartConfig(visualizationWithOptions(options), dateData)

    expect(config.stacking).toBe(expected)
  })

  it('prefers nested stacking options over the legacy flat key', () => {
    const config = resolveChartConfig(
      visualizationWithOptions({
        series: { stacking: 'percent' },
        stacking: 'disabled',
      }),
      dateData,
    )

    expect(config.stacking).toBe('percent')
  })

  it('indexes a saved chart that used a per-series right axis', () => {
    const config = resolveChartConfig(vizWithSeriesOption({ yAxis: 1 }), dateData)

    expect(config.indexed).toBe(true)
  })

  it('indexes a saved chart that mapped a column to the right axis', () => {
    const config = resolveChartConfig(vizWithColumnMapping({ revenue: 'y', ratio: 'yRight' }), dateData)

    expect(config.indexed).toBe(true)
  })

  it('leaves an ordinary single-axis chart unindexed', () => {
    const config = resolveChartConfig(vizWithColumnMapping({ month: 'x', revenue: 'y' }), dateData)

    expect(config.indexed).toBe(false)
  })

  it('honours an explicit indexed option over the inference', () => {
    const config = resolveChartConfig(
      vizWithOptions({ indexed: false, seriesOptions: { a: { yAxis: 1 } } }),
      dateData,
    )

    expect(config.indexed).toBe(false)
  })

  it('turns indexed off when stacking is on, even though the stored option or the migration says otherwise', () => {
    // Two places used to compute "is this chart actually indexed" and
    // disagree: buildChartData skipped indexing while stacking was on, but
    // the renderers showed the indexed axis label from config.indexed alone.
    // So indexed plus stack drew raw magnitudes under an indexed label.
    // Resolving the effective value once, here, means config.indexed can be
    // trusted everywhere else without rechecking stacking.
    const configFromExplicitOption = resolveChartConfig(
      vizWithOptions({ indexed: true, series: { stacking: 'stack' } }),
      dateData,
    )
    expect(configFromExplicitOption.indexed).toBe(false)

    const configFromMigration = resolveChartConfig(
      vizWithOptions({
        columnMapping: { revenue: 'y', ratio: 'yRight' },
        series: { stacking: 'percent' },
      }),
      dateData,
    )
    expect(configFromMigration.indexed).toBe(false)
  })

  it('never indexes a scatter chart, since indexing to 100 is not implemented for scatter (see ScatterChart and the chart editor)', () => {
    // A scatter's y values are not a series over an ordered x, so "indexed
    // to its first value" has no clear meaning there, and ScatterChart plots
    // data.rows directly rather than the indexed chartData. config.indexed
    // must reflect that, or a saved chart carrying an explicit indexed
    // option or a migration signal (a yRight mapping, a per-series right
    // axis) would claim to be indexed while doing nothing about it.
    const configFromExplicitOption = resolveChartConfig(
      vizWithOptions({ globalSeriesType: 'scatter', indexed: true }),
      dateData,
    )
    expect(configFromExplicitOption.indexed).toBe(false)

    const configFromMigration = resolveChartConfig(
      vizWithOptions({ globalSeriesType: 'scatter', columnMapping: { revenue: 'y', ratio: 'yRight' } }),
      dateData,
    )
    expect(configFromMigration.indexed).toBe(false)
  })

  it('never indexes a pie chart, since a pie has slices at one point in time, not a series over an ordered x (see PieChart and the chart editor)', () => {
    // A pie chart has no series over an ordered x, so "indexed to its first
    // nonzero value" has no clear meaning there, same as scatter. PieChart
    // plots and tabulates data.rows directly rather than the indexed
    // chartData ChartRenderer computes, so a config that claimed indexed
    // would attach the "indexed to 100" caption and column suffix to raw
    // values. Reachable through saved JSON: switching a stored line chart's
    // type to pie preserves the other stored options, and pie hides the
    // Index control, so nothing in the editor lets an author turn it back off.
    const configFromExplicitOption = resolveChartConfig(
      vizWithOptions({ globalSeriesType: 'pie', indexed: true }),
      dateData,
    )
    expect(configFromExplicitOption.indexed).toBe(false)

    const configFromMigration = resolveChartConfig(
      vizWithOptions({ globalSeriesType: 'pie', columnMapping: { revenue: 'y', ratio: 'yRight' } }),
      dateData,
    )
    expect(configFromMigration.indexed).toBe(false)
  })

  it('does not rewrite the stored options', () => {
    // The migration reads old fields to infer a new one. Writing the inferred
    // value back would mean a rollback of this phase could not restore the old
    // rendering from the saved JSON.
    const viz = vizWithSeriesOption({ yAxis: 1 })
    const before = structuredClone(viz.options)

    resolveChartConfig(viz, dateData)

    expect(viz.options).toEqual(before)
  })
})

describe('seriesNamesFor', () => {
  it('returns distinct series values in first-seen order when a series column is configured', () => {
    const config = resolveChartConfig(
      visualizationWithOptions({
        columnMapping: { day: 'x', region: 'series', hits: 'y' },
      }),
      {
        ...dateData,
        rows: [
          { day: '2026-07-20', region: 'North', hits: 5 },
          { day: '2026-07-20', region: 'South', hits: 8 },
          { day: '2026-07-21', region: 'North', hits: 6 },
        ],
      },
    )

    expect(seriesNamesFor(config, {
      ...dateData,
      rows: [
        { day: '2026-07-20', region: 'North', hits: 5 },
        { day: '2026-07-20', region: 'South', hits: 8 },
        { day: '2026-07-21', region: 'North', hits: 6 },
      ],
    })).toEqual(['North', 'South'])
  })

  it('returns effective y columns when no series column is configured', () => {
    const config = resolveChartConfig(visualizationWithOptions(), dateData)

    expect(seriesNamesFor(config, dateData)).toEqual(['hits', 'rate'])
  })
})

describe('curveTypeFor', () => {
  it('prefers a per-series curve override and otherwise returns the fallback', () => {
    const config = resolveChartConfig(
      visualizationWithOptions({
        seriesOptions: { hits: { curve: 'step' } },
      }),
      dateData,
    )

    expect(curveTypeFor('hits', config, 'monotone')).toBe('step')
    expect(curveTypeFor('rate', config, 'natural')).toBe('natural')
  })
})
