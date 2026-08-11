// KPI_HISTORY's registration and its validate hook.
//
// Read through the registry rather than off the exported object, because the
// thing worth asserting is that this type is reachable the way every render
// surface reaches one. Importing the plugin directly would still pass with the
// entry missing from CORE_VISUALIZATIONS.
import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { getVisualization, registeredTypes } from '@/lib/visualizations'
import { isRenderableComponent } from '@/test/component-shape'

const data: QueryResultData = {
  columns: [
    { name: 'measured_at', friendly_name: 'Measured At', type: 'datetime' },
    { name: 'on_time_pct', friendly_name: 'On Time (%)', type: 'float' },
  ],
  rows: [{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: 91.4 }],
}

// Three readings whose rows are NOT in time order: the 7th, then the 5th, then
// the 6th. Ordered by value descending, which is a thing a query says on
// purpose, and it draws a chronology that runs backwards and then forwards.
const shuffled: QueryResultData = {
  columns: data.columns,
  rows: [
    { measured_at: '2026-03-07T06:00:00Z', on_time_pct: 92.3 },
    { measured_at: '2026-03-05T06:00:00Z', on_time_pct: 91.4 },
    { measured_at: '2026-03-06T06:00:00Z', on_time_pct: 85.2 },
  ],
}

const CONFIGURED = {
  timeColumn: 'measured_at',
  valueColumn: 'on_time_pct',
  unit: '%',
  target: { value: 90, direction: 'higher-is-better' },
  thresholds: { atRisk: 88, breached: 82 },
}

// A missing hook has to read as a failure rather than as "no problems": every
// assertion below is about what validate says, and `?.` would quietly turn a
// deleted hook into a passing suite.
function validate(options: Record<string, unknown>, result: QueryResultData = data): string[] {
  const plugin = getVisualization('KPI_HISTORY')
  if (!plugin?.validate) return ['KPI_HISTORY has no validate hook']
  return plugin.validate(options, result)
}

describe('the KPI history visualization', () => {
  it('is registered with everything a creatable type needs', () => {
    const plugin = getVisualization('KPI_HISTORY')

    expect(registeredTypes()).toContain('KPI_HISTORY')
    expect(isRenderableComponent(plugin?.Renderer)).toBe(true)
    expect(isRenderableComponent(plugin?.Editor)).toBe(true)
    expect(plugin?.choices?.map((choice) => choice.id)).toEqual(['kpi-history'])
    // Declared, not omitted: an omitted schema publishes nothing, which for
    // this type strips the target the whole picture is about.
    expect(Object.keys(plugin?.publicOptions ?? {})).toContain('target')
  })

  it('says nothing about a fully configured visualization', () => {
    expect(validate(CONFIGURED)).toEqual([])
  })

  // The defect the shared helper exists for: a column named in the options that
  // the query no longer returns draws a blank chart and says nothing.
  it('names a value column the query stopped returning', () => {
    expect(validate({ ...CONFIGURED, valueColumn: 'on_time_ratio' })).toEqual([
      'The value column "on_time_ratio" is not in this query result.',
    ])
  })

  it('names a time column the query stopped returning', () => {
    expect(validate({ ...CONFIGURED, timeColumn: 'recorded_at' })).toEqual([
      'The time column "recorded_at" is not in this query result.',
    ])
  })

  // Both halves of the comparison are read together, and each one alone is a
  // silent failure of its own kind. Neither renders an error; they render a
  // chart that quietly stops making the comparison it exists to make.
  it('reports thresholds set without a target', () => {
    expect(validate({ ...CONFIGURED, target: undefined })).toEqual([
      'Thresholds are set but no target is, so there is no scale to place a status band on. Set a target as well.',
    ])
  })

  it('reports a target set without thresholds', () => {
    expect(validate({ ...CONFIGURED, thresholds: undefined })).toEqual([
      'A target is set but no thresholds are, so the axis is scaled to the readings alone and the target line can fall outside it. Set At Risk and Breached as well.',
    ])
  })

  // "You have not finished configuring this" is a different message from "this
  // names something that does not exist", and reporting the first as a problem
  // would light up every freshly created widget.
  it('says nothing about a visualization with neither', () => {
    expect(validate({ timeColumn: 'measured_at', valueColumn: 'on_time_pct' })).toEqual([])
  })

  it('says nothing about a widget created from the builder tile, which has no options at all', () => {
    expect(validate({})).toEqual([])
  })
})

// What the editor leaves behind, and what the renderer then resolves, are two
// different things. Checking the objects rather than the numbers in them let
// every case below through: the chart lost its target line, its scale and its
// bands, and nothing anywhere said so.
describe('a target the renderer cannot draw', () => {
  // Clearing the Target input calls updateTarget({ value: undefined }), which
  // merges over the direction already there, and `pruned` keeps the group
  // because the direction is still defined.
  it('reports a target whose value was cleared but whose direction remains', () => {
    expect(validate({ ...CONFIGURED, target: { direction: 'higher-is-better' } })).toEqual([
      'The target has a direction but no value, so neither the target line nor the status bands are drawn. Enter a target value.',
    ])
  })

  it('reports a target value that is not a number at all', () => {
    expect(validate({ ...CONFIGURED, target: { value: 'ninety' } })).toEqual([
      'The target has a direction but no value, so neither the target line nor the status bands are drawn. Enter a target value.',
    ])
  })

  // `pruned` is what normally stops this reaching storage, but an options bag
  // arrives from a promoted dashboard, a public report and a hand-edited
  // Redash row as well, and an empty group means unconfigured, not half done.
  it('treats an empty target object as no target rather than as a broken one', () => {
    expect(validate({ timeColumn: 'measured_at', target: {}, thresholds: {} })).toEqual([])
  })
})

describe('thresholds the renderer cannot draw', () => {
  it('reports half a threshold pair', () => {
    expect(validate({ ...CONFIGURED, thresholds: { atRisk: 88 } })).toEqual([
      'A status band needs both At Risk and Breached as numbers. Set both, or clear both.',
    ])
  })

  // The invariant is kpi-form-model's, reused rather than restated: for higher
  // is better, at risk sits ABOVE breached. Inverted, statusForValue calls a
  // reading of 80 breached between 70 and 90, and the bands overlap.
  it('reports thresholds inverted for higher-is-better', () => {
    expect(
      validate({ ...CONFIGURED, thresholds: { atRisk: 70, breached: 90 } })
    ).toEqual(['For higher is better, the at risk threshold must be above the breached threshold.'])
  })

  it('reports thresholds inverted for lower-is-better', () => {
    expect(
      validate({
        ...CONFIGURED,
        target: { value: 4, direction: 'lower-is-better' },
        thresholds: { atRisk: 90, breached: 70 },
      })
    ).toEqual(['For lower is better, the at risk threshold must be below the breached threshold.'])
  })

  // Coinciding thresholds leave no at-risk band for a reading to fall in, so
  // the KPI can never be at risk. statusBands drops the zero-height area and
  // draws nothing, which is why this has to be said rather than shown.
  it('reports thresholds that are equal', () => {
    expect(validate({ ...CONFIGURED, thresholds: { atRisk: 85, breached: 85 } })).toEqual([
      'For higher is better, the at risk threshold must be above the breached threshold.',
    ])
  })
})

describe('rows that are not in time order', () => {
  // Reported rather than sorted: row order is the query's answer, and the fix
  // belongs in the query, where an ORDER BY either is or is not.
  it('reports a result whose rows run backwards through time', () => {
    expect(validate(CONFIGURED, shuffled)).toEqual([
      'The rows are not in ascending time order, so the line is drawn in the order the query returned them rather than left to right in time. Order the query by the time column, ascending.',
    ])
  })

  it('says nothing about rows that are in time order', () => {
    expect(
      validate(CONFIGURED, {
        columns: shuffled.columns,
        rows: [...shuffled.rows].sort((a, b) => String(a.measured_at).localeCompare(String(b.measured_at))),
      })
    ).toEqual([])
  })

  // A time column may hold bucket labels rather than instants. Nothing can put
  // those in order, so calling them out of order is a warning nobody can act
  // on.
  it('says nothing about a time column no parser can read', () => {
    expect(
      validate(CONFIGURED, {
        columns: shuffled.columns,
        rows: [
          { measured_at: 'Week 3', on_time_pct: 92.3 },
          { measured_at: 'Week 1', on_time_pct: 91.4 },
        ],
      })
    ).toEqual([])
  })
})

// The plugin interface says validate must never throw: it runs on every render
// of every widget, and a throw here takes down a tile that was drawing fine.
// Only the registry's try/catch stands behind it, and that degrades to "no
// problems", which is the silence this whole hook exists to break.
it('does not throw on an options bag that is nothing like the shape it expects', () => {
  const junk = [
    { target: null, thresholds: null },
    { target: 90, thresholds: 'none' },
    { target: { value: null }, thresholds: [88, 82] },
    { timeColumn: 42, valueColumn: false },
  ]

  for (const options of junk) {
    expect(() => validate(options as Record<string, unknown>)).not.toThrow()
  }
})
