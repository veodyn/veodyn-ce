import { describe, expect, it, vi } from 'vitest'
import type { ContextReader } from './redash-get'
import { readSubjectDetail, SUBJECT_SQL_CHARS, type ChatSubjectDetail } from './subject-detail'

const QUERY = {
  id: 7,
  name: 'Rail boardings',
  can_edit: true,
  data_source_id: 3,
  query: 'select route,\n  sum(n)\nfrom boardings',
  schedule: { interval: 3600, time: null, day_of_week: null, until: null },
  options: { parameters: [{ name: 'route', type: 'text' }] },
  visualizations: [
    { id: 11, type: 'TABLE', name: 'Table', options: {} },
    { id: 12, type: 'CHART', name: 'Trend', options: { globalSeriesType: 'line', legend: { enabled: true } } },
  ],
}

const DASHBOARD = {
  id: 4,
  name: 'Ops',
  can_edit: false,
  widgets: [
    {
      id: 21,
      text: '',
      visualization_id: 12,
      visualization: { id: 12, type: 'CHART', name: 'Trend', query: { id: 7, name: 'Rail boardings' } },
      options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 4 } },
    },
    { id: 22, text: 'Notes here', visualization: null, options: { position: { col: 3, row: 0, sizeX: 3, sizeY: 2 } } },
  ],
}

function readerOf(bodies: Record<string, unknown>) {
  const get = vi.fn(async (path: string) => (path in bodies ? bodies[path] : null))
  return { key: '', get } as unknown as ContextReader & { get: typeof get }
}

const signal = new AbortController().signal

function linesOf(detail: ChatSubjectDetail | null): string[] {
  if (!detail) throw new Error('expected a subject detail')
  return detail.lines
}

function sqlOf(lines: string[]): string[] {
  return lines.slice(lines.indexOf('SQL:') + 1)
}

describe('readSubjectDetail', () => {
  it('describes a query with its source, parameters, visualizations, schedule and SQL', async () => {
    const detail = await readSubjectDetail({ kind: 'query', queryId: 7 }, readerOf({ '/api/queries/7': QUERY }), signal)
    expect(detail).toMatchObject({ kind: 'query', id: '7', name: 'Rail boardings', canEdit: true })
    const lines = linesOf(detail)
    expect(lines).toContain('data source: 3')
    expect(lines).toContain('parameters: route (text)')
    expect(lines).toContain('visualizations: 11 TABLE "Table"; 12 CHART "Trend"')
    expect(lines.some((line) => line.startsWith('schedule: '))).toBe(true)
    expect(sqlOf(lines)).toEqual(['select route,', '  sum(n)', 'from boardings'])
  })

  it('clips long SQL and keeps every line and the line count inside the sidecar limits', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `select ${'x'.repeat(60)} -- ${i}`).join('\n')
    const detail = await readSubjectDetail(
      { kind: 'query', queryId: 7 },
      readerOf({ '/api/queries/7': { ...QUERY, query: long } }),
      signal
    )
    const lines = linesOf(detail)
    expect(lines.length).toBeLessThanOrEqual(40)
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(500)
    expect(sqlOf(lines).join('').length).toBeLessThanOrEqual(SUBJECT_SQL_CHARS)
  })

  it('clips a single enormous line of SQL to the character budget', async () => {
    const detail = await readSubjectDetail(
      { kind: 'query', queryId: 7 },
      readerOf({ '/api/queries/7': { ...QUERY, query: 'z'.repeat(50_000) } }),
      signal
    )
    expect(sqlOf(linesOf(detail)).join('')).toBe('z'.repeat(SUBJECT_SQL_CHARS))
    expect(linesOf(detail).every((line) => line.length <= 500)).toBe(true)
  })

  it('describes a visualization by its query and its own settings', async () => {
    const detail = await readSubjectDetail(
      { kind: 'visualization', queryId: 7, visualizationId: 12 },
      readerOf({ '/api/queries/7': QUERY }),
      signal
    )
    expect(detail).toMatchObject({ kind: 'visualization', id: '12', name: 'Rail boardings: Trend', canEdit: true })
    expect(linesOf(detail)).toContain('type: CHART')
    expect(linesOf(detail)).toContain('query: 7 "Rail boardings"')
    expect(linesOf(detail)).toContain('options set: globalSeriesType, legend')
  })

  it('gives nothing for a visualization the query no longer has', async () => {
    const detail = await readSubjectDetail(
      { kind: 'visualization', queryId: 7, visualizationId: 99 },
      readerOf({ '/api/queries/7': QUERY }),
      signal
    )
    expect(detail).toBeNull()
  })

  it('describes a dashboard with one line per widget', async () => {
    const detail = await readSubjectDetail(
      { kind: 'dashboard', dashboardId: 4 },
      readerOf({ '/api/dashboards/4': DASHBOARD }),
      signal
    )
    expect(detail).toMatchObject({ kind: 'dashboard', id: '4', name: 'Ops', canEdit: false })
    expect(linesOf(detail)).toEqual([
      'widget 21 (visualization) "Rail boardings: Trend" at col 0, row 0, size 3x4',
      'widget 22 (text) "Notes here" at col 3, row 0, size 3x2',
    ])
  })

  it('caps a dashboard with many widgets and says how many were left out', async () => {
    const widgets = Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, text: `note ${i}`, options: {} }))
    const detail = await readSubjectDetail(
      { kind: 'dashboard', dashboardId: 4 },
      readerOf({ '/api/dashboards/4': { ...DASHBOARD, widgets } }),
      signal
    )
    expect(linesOf(detail)).toHaveLength(40)
    expect(linesOf(detail)[39]).toBe('and 21 more widgets')
  })

  it('describes a widget by its dashboard, kind, query and position', async () => {
    const detail = await readSubjectDetail(
      { kind: 'widget', dashboardId: 4, widgetId: 21 },
      readerOf({ '/api/dashboards/4': DASHBOARD }),
      signal
    )
    expect(detail).toMatchObject({ kind: 'widget', id: '21', name: 'Ops', canEdit: false })
    expect(linesOf(detail)).toEqual([
      'dashboard: 4 "Ops"',
      'kind: visualization',
      'title: Rail boardings: Trend',
      'query: 7',
      'visualization: 12',
      'position: col 0, row 0, size 3x4',
    ])
  })

  it('gives nothing for a widget that was removed', async () => {
    const detail = await readSubjectDetail(
      { kind: 'widget', dashboardId: 4, widgetId: 5 },
      readerOf({ '/api/dashboards/4': DASHBOARD }),
      signal
    )
    expect(detail).toBeNull()
  })

  it('gives nothing when the read fails, instead of throwing', async () => {
    const reader = { key: '', get: vi.fn(async () => Promise.reject(new Error('node down'))) } as unknown as ContextReader
    await expect(readSubjectDetail({ kind: 'query', queryId: 7 }, reader, signal)).resolves.toBeNull()
    await expect(readSubjectDetail({ kind: 'query', queryId: 8 }, readerOf({}), signal)).resolves.toBeNull()
  })

  it('describes a dataset by its id alone', async () => {
    const reader = readerOf({})
    const detail = await readSubjectDetail({ kind: 'dataset', datasetId: 'gtfs_stops' }, reader, signal)
    expect(detail).toEqual({ kind: 'dataset', id: 'gtfs_stops', name: 'gtfs_stops', lines: [] })
    expect(reader.get).not.toHaveBeenCalled()
  })

  it('sends a new-object subject without reading anything', async () => {
    const reader = readerOf({})
    const detail = await readSubjectDetail({ kind: 'new', newKind: 'dashboard' }, reader, signal)
    expect(detail).toEqual({ kind: 'new', id: 'dashboard', name: 'dashboard', lines: [] })
    expect(reader.get).not.toHaveBeenCalled()
  })
})
