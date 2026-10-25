import { describe, expect, it } from 'vitest'
import { CORE_AUTHORING } from './core-authoring'
import { describeAuthoring } from './describe'

describe('describeAuthoring', () => {
  it('lists CHART globalSeriesType with its enum', () => {
    const described = describeAuthoring('CHART')
    const field = described?.options.find((o) => o.key === 'globalSeriesType')
    expect(described?.type).toBe('CHART')
    expect(described?.label).toBe('Chart')
    expect(field).toMatchObject({
      key: 'globalSeriesType',
      rule: 'string',
      enum: ['line', 'bar', 'area', 'pie', 'scatter'],
    })
    expect(field?.description.length).toBeGreaterThan(0)
  })

  it('renders a column mapping with its roles', () => {
    const field = describeAuthoring('CHART')?.options.find((o) => o.key === 'columnMapping')
    expect(field?.rule).toBe('map of column to x|y|series|yRight')
    expect(field?.column).toBe('mapKeys')
    expect(field?.enum).toBeUndefined()
  })

  it('renders nested rules as short strings', () => {
    const byKey = Object.fromEntries((describeAuthoring('CHART')?.options ?? []).map((o) => [o.key, o.rule]))
    expect(byKey.swappedAxes).toBe('boolean')
    expect(byKey.series).toBe('object {stacking: string}')
    expect(byKey.yAxis).toBe('list of object {type: string, rangeMin: number, rangeMax: number}')
    expect(byKey.seriesOptions).toBe('map of name to object {name: string, color: string, type: string, curve: string}')
  })

  it('carries column kind and default', () => {
    const funnel = describeAuthoring('FUNNEL')?.options
    expect(funnel?.find((o) => o.key === 'stepColumn')?.column).toBe('one')
    expect(funnel?.find((o) => o.key === 'sortOrder')?.default).toBe('desc')
  })

  it('returns an entry for every core type, in declaration order', () => {
    for (const type of Object.keys(CORE_AUTHORING)) {
      const described = describeAuthoring(type)
      expect(described?.options.map((o) => o.key)).toEqual(Object.keys(CORE_AUTHORING[type]))
    }
  })

  it('survives a JSON round trip', () => {
    for (const type of Object.keys(CORE_AUTHORING)) {
      const described = describeAuthoring(type)
      expect(JSON.parse(JSON.stringify(described))).toEqual(described)
    }
  })

  it('returns null for a type with no declaration', () => {
    expect(describeAuthoring('NOT_A_TYPE')).toBeNull()
  })
})
