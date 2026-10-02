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

  it('refuses an unknown tool and arguments that belong to another tool', () => {
    expect(parseFrame('tool_request', { callId: 'a', tool: 'drop_table', args: {} }, null)).toBeNull()
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

  it('carries a settled source count', () => {
    const settled = { callId: 'a', ok: true, durationMs: 5, sourceCount: 2 }
    expect(parseFrame('tool_settled', settled, null)?.data).toEqual(settled)
  })
})
