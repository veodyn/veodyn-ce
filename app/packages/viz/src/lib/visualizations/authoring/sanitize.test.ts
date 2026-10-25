import { describe, expect, it } from 'vitest'
import { CORE_AUTHORING } from './core-authoring'
import { sanitizeAuthored } from './sanitize'

describe('sanitizeAuthored', () => {
  it('drops keys the schema does not declare', () => {
    const out = sanitizeAuthored(CORE_AUTHORING.PIVOT, { rowField: 'a', aggregation: 'sum', secret: 'x', __proto__: { y: 1 } })
    expect(out).toEqual({ rowField: 'a', aggregation: 'sum' })
  })

  it('drops a value outside the enum', () => {
    expect(sanitizeAuthored(CORE_AUTHORING.PIVOT, { rowField: 'a', aggregation: 'median' })).toEqual({ rowField: 'a' })
  })

  it('drops a value of the wrong shape', () => {
    expect(sanitizeAuthored(CORE_AUTHORING.CHART, { swappedAxes: 'yes', showDataLabels: true, indexed: 1 })).toEqual({
      showDataLabels: true,
    })
  })

  it('keeps nested objects and arrays, dropping unknown nested keys', () => {
    const out = sanitizeAuthored(CORE_AUTHORING.CHART, {
      yAxis: [{ type: 'logarithmic', rangeMin: 1, junk: true }],
      referenceLines: [{ value: 3, label: 'goal', color: 'red' }],
      seriesOptions: { Sales: { color: '#fff', name: 'Total', bogus: 1 } },
    })
    expect(out).toEqual({
      yAxis: [{ type: 'logarithmic', rangeMin: 1 }],
      referenceLines: [{ value: 3, label: 'goal' }],
      seriesOptions: { Sales: { color: '#fff', name: 'Total' } },
    })
  })

  it('drops column mapping entries whose role is not offered', () => {
    const out = sanitizeAuthored(CORE_AUTHORING.CHART, { columnMapping: { a: 'x', b: 'banana', c: 'series' } })
    expect(out).toEqual({ columnMapping: { a: 'x', c: 'series' } })
  })

  it('keeps an empty column mapping', () => {
    expect(sanitizeAuthored(CORE_AUTHORING.CHART, { columnMapping: {} })).toEqual({ columnMapping: {} })
  })

  it('returns an empty object for input that is not an object', () => {
    expect(sanitizeAuthored(CORE_AUTHORING.CHART, null)).toEqual({})
    expect(sanitizeAuthored(CORE_AUTHORING.CHART, [1])).toEqual({})
    expect(sanitizeAuthored(CORE_AUTHORING.CHART, 'x')).toEqual({})
  })

  it('drops options that belong only to the previous type', () => {
    const chartOptions = { globalSeriesType: 'bar', columnMapping: { a: 'x' }, rowField: 'a', stepColumn: 'b' }
    expect(sanitizeAuthored(CORE_AUTHORING.PIVOT, chartOptions)).toEqual({ rowField: 'a' })
    expect(sanitizeAuthored(CORE_AUTHORING.FUNNEL, chartOptions)).toEqual({ stepColumn: 'b' })
  })
})
