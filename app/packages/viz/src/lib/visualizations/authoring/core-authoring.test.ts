import { describe, expect, it } from 'vitest'
import '..'
import { CORE_VISUALIZATIONS } from '../core'
import { NAMED_COLUMNS } from '../core-options'
import { CORE_AUTHORING, CORE_LABELS } from './core-authoring'

const EDITOR_SETTABLE: Record<string, string[]> = {
  TABLE: ['columns'],
  CHART: [
    'globalSeriesType', 'columnMapping', 'series', 'swappedAxes', 'donut', 'seriesOptions',
    'xAxis', 'reverseX', 'yAxis', 'indexed', 'referenceLines', 'showDataLabels',
  ],
  COUNTER: [
    'counterLabel', 'countRow', 'counterColName', 'rowNumber', 'targetColName',
    'stringPrefix', 'stringSuffix', 'stringDecimal',
  ],
  PIVOT: ['rowField', 'colField', 'valueField', 'aggregation'],
  FUNNEL: ['stepColumn', 'valueColumn', 'sortOrder'],
  DETAILS: ['columns'],
  MAP: ['latColName', 'lonColName', 'classify', 'popup'],
  HEATMAP: ['columnMapping', 'aggregation', 'showValues', 'clipOutliers', 'sortRows'],
  BOXPLOT: ['columnMapping'],
  SANKEY: ['columnMapping'],
  CHOROPLETH: ['boundarySource', 'keyColumn', 'targetField', 'valueColumn', 'mapType', 'geometryColumn'],
  COHORT: ['dateColumn', 'stageColumn', 'totalColumn', 'valueColumn'],
  SUNBURST_SEQUENCE: ['valueColumn'],
  KPI_HISTORY: ['timeColumn', 'valueColumn', 'unit', 'target', 'thresholds'],
  WORD_CLOUD: ['column', 'frequenciesColumn', 'wordLengthLimit', 'wordCountLimit'],
}

describe('CORE_AUTHORING', () => {
  it('declares every core type and nothing else', () => {
    expect(Object.keys(CORE_AUTHORING).sort()).toEqual(CORE_VISUALIZATIONS.map((p) => p.type).sort())
    expect(Object.keys(CORE_AUTHORING).sort()).toEqual(Object.keys(EDITOR_SETTABLE).sort())
  })

  it.each(Object.entries(EDITOR_SETTABLE))('%s declares exactly the options its editor writes', (type, keys) => {
    expect(Object.keys(CORE_AUTHORING[type]).sort()).toEqual([...keys].sort())
  })

  it.each(Object.keys(EDITOR_SETTABLE))('%s has one-line descriptions on every option', (type) => {
    for (const [key, field] of Object.entries(CORE_AUTHORING[type])) {
      expect(field.description, `${type}.${key}`).toMatch(/^[^\n]{8,300}$/)
    }
  })

  it('labels each type as the registry does', () => {
    for (const plugin of CORE_VISUALIZATIONS) expect(CORE_LABELS[plugin.type]).toBe(plugin.displayName)
  })

  it('marks every flat named column as a single column', () => {
    const typeFor: Record<string, string> = { SUNBURST: 'SUNBURST_SEQUENCE' }
    for (const [group, entries] of Object.entries(NAMED_COLUMNS)) {
      const type = typeFor[group] ?? group
      for (const { key } of entries) {
        expect(CORE_AUTHORING[type][key]?.column, `${type}.${key}`).toBe('one')
      }
    }
  })

  it('marks the multi-column options with their kind', () => {
    expect(CORE_AUTHORING.CHART.columnMapping.column).toBe('mapKeys')
    expect(CORE_AUTHORING.HEATMAP.columnMapping.column).toBe('mapKeys')
    expect(CORE_AUTHORING.BOXPLOT.columnMapping.column).toBe('mapKeys')
    expect(CORE_AUTHORING.SANKEY.columnMapping.column).toBe('mapKeys')
    expect(CORE_AUTHORING.DETAILS.columns.column).toBe('list')
    expect(CORE_AUTHORING.TABLE.columns.column).toBe('listOfObjectsByName')
  })

  it('does not mark options that name something other than a result column', () => {
    expect(CORE_AUTHORING.CHOROPLETH.targetField.column).toBeUndefined()
    expect(CORE_AUTHORING.CHART.seriesOptions.column).toBeUndefined()
  })

  it('lists the roles each column mapping accepts', () => {
    expect(CORE_AUTHORING.CHART.columnMapping.enum).toEqual(['x', 'y', 'series', 'yRight'])
    expect(CORE_AUTHORING.HEATMAP.columnMapping.enum).toEqual(['x', 'y', 'value'])
    expect(CORE_AUTHORING.BOXPLOT.columnMapping.enum).toEqual(['category', 'value'])
    expect(CORE_AUTHORING.SANKEY.columnMapping.enum).toEqual(['source', 'target', 'value'])
  })

  it('takes enum values from the editors', () => {
    expect(CORE_AUTHORING.CHART.globalSeriesType.enum).toEqual(['line', 'bar', 'area', 'pie', 'scatter'])
    expect(CORE_AUTHORING.PIVOT.aggregation.enum).toEqual(['sum', 'avg', 'count', 'min', 'max'])
    expect(CORE_AUTHORING.FUNNEL.sortOrder.enum).toEqual(['desc', 'asc'])
    expect(CORE_AUTHORING.HEATMAP.aggregation.enum).toEqual(['sum', 'count', 'avg', 'min', 'max'])
    expect(CORE_AUTHORING.HEATMAP.showValues.enum).toEqual(['auto', 'always', 'never'])
    expect(CORE_AUTHORING.HEATMAP.sortRows.enum).toEqual(['none', 'total', 'peak'])
    expect(CORE_AUTHORING.CHOROPLETH.targetField.enum).toEqual(['name', 'iso_a2', 'iso_a3'])
    expect(CORE_AUTHORING.CHOROPLETH.boundarySource.enum).toEqual(['map', 'column'])
    expect(CORE_AUTHORING.CHOROPLETH.mapType.enum).toEqual(['world-countries'])
  })

  it('only reads the geometry column when the boundaries come from one', () => {
    expect(CORE_AUTHORING.CHOROPLETH.geometryColumn.appliesTo).toEqual({ key: 'boundarySource', equals: 'column' })
  })
})
