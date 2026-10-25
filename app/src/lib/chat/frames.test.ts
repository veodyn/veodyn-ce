import { describe, expect, it } from 'vitest'
import { parseFrame } from './frames'

describe('parseFrame tool requests', () => {
  it('accepts each tool with its own arguments', () => {
    const requests = [
      { callId: 'a', tool: 'search_library', args: { text: 'bikeshare', kinds: ['query'], tags: [] } },
      { callId: 'b', tool: 'show_visualization', args: { queryId: 12, visualizationId: null } },
      { callId: 'c', tool: 'open_dashboard', args: { dashboardId: 4 } },
      {
        callId: 'd',
        tool: 'run_query',
        args: { dataSourceId: 5, sql: 'SELECT 1', purpose: 'x', vizChoiceId: 'table' },
      },
      { callId: 'e', tool: 'list_data_sources', args: {} },
      { callId: 'f', tool: 'describe_data_source', args: { dataSourceId: 7 } },
    ]
    for (const request of requests) {
      expect(parseFrame('tool_request', request, '1-1')?.data).toEqual(request)
    }
  })

  it('refuses arguments that belong to another tool', () => {
    expect(
      parseFrame('tool_request', { callId: 'a', tool: 'open_dashboard', args: { queryId: 12 } }, null)
    ).toBeNull()
    expect(
      parseFrame('tool_request', { callId: 'a', tool: 'search_library', args: { text: '', kinds: [], tags: [] } }, null)
    ).toBeNull()
  })

  it('accepts a help link and a whole-page link', () => {
    const section = {
      callId: 'h1',
      page: 'features/queries',
      pageTitle: 'Queries',
      anchor: 'parameters',
      sectionTitle: 'Parameters',
      reason: 'How to add a date filter',
    }
    expect(parseFrame('help_link', section, '1-1')?.data).toEqual(section)
    const page = { ...section, anchor: null, sectionTitle: null }
    expect(parseFrame('help_link', page, '1-1')?.data).toEqual(page)
  })

  it('refuses a help link without a page or with an over-long anchor', () => {
    const base = { callId: 'h1', pageTitle: 'Queries', anchor: null, sectionTitle: null, reason: 'x' }
    expect(parseFrame('help_link', base, null)).toBeNull()
    expect(parseFrame('help_link', { ...base, page: 'p', anchor: 'a'.repeat(201) }, null)).toBeNull()
  })

  it('carries a settled count', () => {
    const settled = { callId: 'a', ok: true, durationMs: 5, count: 3 }
    expect(parseFrame('tool_settled', settled, null)?.data).toEqual(settled)
  })

  it('accepts a 4096-character description in update_query and refuses 4097', () => {
    const request = (description: string) => ({
      callId: 'u',
      tool: 'update_query',
      args: { queryId: 5, changes: { description } },
    })
    expect(parseFrame('tool_request', request('d'.repeat(4096)), '1-1')).not.toBeNull()
    expect(parseFrame('tool_request', request('d'.repeat(4097)), '1-1')).toBeNull()
  })

  it('accepts open_query with a query id and refuses one without', () => {
    const request = { callId: 'q', tool: 'open_query', args: { queryId: 5 } }
    expect(parseFrame('tool_request', request, '1-1')?.data).toEqual(request)
    expect(parseFrame('tool_request', { callId: 'q', tool: 'open_query', args: {} }, null)).toBeNull()
  })

  it('keeps parameters on a query proposal draft', () => {
    const payload = {
      name: 'Trips',
      description: '',
      sql: 'select {{ day }}',
      dataSourceId: 1,
      vizChoiceId: 'table',
      vizOptions: {},
      parameters: [{ name: 'day', type: 'enum', enumOptions: 'a\nb', multi: true, quote: 'single' }],
    }
    const draft = { draftId: 'd1', version: 1, kind: 'query', payload }
    expect(parseFrame('draft', draft, '1-2')?.data).toEqual(draft)
  })

  it('carries a settled source count', () => {
    const settled = { callId: 'a', ok: true, durationMs: 5, sourceCount: 2 }
    expect(parseFrame('tool_settled', settled, null)?.data).toEqual(settled)
  })
})
