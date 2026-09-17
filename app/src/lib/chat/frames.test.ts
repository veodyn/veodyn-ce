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

  it('carries a settled count', () => {
    const settled = { callId: 'a', ok: true, durationMs: 5, count: 3 }
    expect(parseFrame('tool_settled', settled, null)?.data).toEqual(settled)
  })
})
