import { describe, expect, it } from 'vitest'
import { parseFrame } from './frames'
import { promotionPatchRequestSchema, promotionRequestSchema, toolResultRequestSchema } from './wire'

const KPI_CALL = {
  name: 'On-time rate',
  description: '',
  sourceQueryId: 12,
  queryDraftId: null,
  valueColumn: 'rate',
  unit: '%',
  target: 90,
  direction: 'higher-is-better',
  cadence: 'daily',
  atRisk: null,
  breached: null,
}

describe('tool requests the sidecar can now send', () => {
  it('accepts the snippet and KPI client calls', () => {
    const requests = [
      { callId: 'a', tool: 'update_snippet', args: { snippetId: 3, trigger: 'dt' } },
      { callId: 'b', tool: 'delete_snippet', args: { snippetId: 3 } },
      { callId: 'c', tool: 'propose_kpi', args: KPI_CALL },
      { callId: 'd', tool: 'propose_kpi', args: { ...KPI_CALL, sourceQueryId: null, queryDraftId: 'draft-1', atRisk: 80, breached: 70 } },
    ]
    for (const request of requests) {
      expect(parseFrame('tool_request', request, '1-1')?.data).toEqual(request)
    }
  })

  it('refuses a snippet call with the wrong arguments', () => {
    expect(parseFrame('tool_request', { callId: 'a', tool: 'delete_snippet', args: { snippetId: 0 } }, null)).toBeNull()
    expect(
      parseFrame('tool_request', { callId: 'a', tool: 'update_snippet', args: { snippetId: 1, extra: 1 } }, null)
    ).toBeNull()
  })

  it('passes a tool only a pack knows to the registry instead of failing the stream', () => {
    const request = { callId: 'a', tool: 'update_kpi', args: { kpiId: 'k', changes: { target: 5 } } }
    expect(parseFrame('tool_request', request, '1-1')?.data).toEqual(request)
    expect(parseFrame('tool_request', { callId: 'a', tool: 'update_kpi', args: 'nope' }, null)).toBeNull()
  })
})

describe('the result kind the sidecar expects', () => {
  it('rides on a tool request without failing the strict schemas, and is kept for a tool only a pack names', () => {
    const known = parseFrame(
      'tool_request',
      { callId: 'a', tool: 'delete_snippet', args: { snippetId: 3 }, resultKind: 'snippet_check' },
      '1-1'
    )
    expect(known?.data).toEqual({ callId: 'a', tool: 'delete_snippet', args: { snippetId: 3 } })
    const open = parseFrame(
      'tool_request',
      { callId: 'b', tool: 'update_kpi', args: {}, resultKind: 'kpi_edit_check' },
      '1-2'
    )
    expect(open?.data).toEqual({ callId: 'b', tool: 'update_kpi', args: {}, resultKind: 'kpi_edit_check' })
  })

  it('refuses a result kind that is not a short string', () => {
    expect(parseFrame('tool_request', { callId: 'a', tool: 'update_kpi', args: {}, resultKind: 5 }, null)).toBeNull()
  })
})

describe('draft frames for kinds the community does not draw itself', () => {
  it('accepts every Part 6 kind and any other kind with an object payload', () => {
    const payloads: Record<string, Record<string, unknown>> = {
      snippet: { trigger: 'dt', snippet: 'select 1', description: '' },
      snippet_edit: { snippetId: 3, snapshot: {}, changes: {} },
      kpi: KPI_CALL,
      report: { goal: 'g', title: 't', sections: [] },
      message: { title: 't', header: 'h', description: 'd' },
      kpi_edit: { kpiId: 'k' },
    }
    for (const [kind, payload] of Object.entries(payloads)) {
      const frame = { draftId: 'd1', version: 1, kind, payload }
      expect(parseFrame('draft', frame, '1-1')?.data).toEqual(frame)
    }
  })

  it('still checks the kinds it does draw', () => {
    expect(parseFrame('draft', { draftId: 'd1', version: 1, kind: 'query', payload: { name: 'x' } }, null)).toBeNull()
  })

  it('refuses a payload that is not an object', () => {
    expect(parseFrame('draft', { draftId: 'd1', version: 1, kind: 'kpi', payload: 'x' }, null)).toBeNull()
  })
})

describe('what the proxy lets through to the sidecar', () => {
  it('accepts any named promotion target and leaves the registry to the sidecar', () => {
    for (const targetType of ['query', 'snippet', 'kpi', 'report', 'message']) {
      expect(promotionRequestSchema.safeParse({ version: 1, targetType }).success).toBe(true)
    }
    expect(promotionRequestSchema.safeParse({ version: 1, targetType: '' }).success).toBe(false)
    expect(promotionRequestSchema.safeParse({ version: 1, targetType: 'x'.repeat(33) }).success).toBe(false)
    expect(promotionPatchRequestSchema.safeParse({ status: 'done', targetId: '4' }).success).toBe(true)
  })

  it('accepts snippet and KPI checks and a result kind only a pack knows', () => {
    const results = [
      { kind: 'snippet_check', ok: true, mode: 'delete', snippetId: 3, snapshot: { trigger: 't', snippet: 's', description: '', updatedAt: 'x' } },
      { kind: 'kpi_check', ok: true, sourceQueryId: 12, queryName: 'q', columns: ['rate'] },
      { kind: 'kpi_edit_check', ok: true, kpiId: 'k' },
    ]
    for (const result of results) {
      expect(toolResultRequestSchema.safeParse({ callId: 'a', result }).success).toBe(true)
    }
    expect(toolResultRequestSchema.safeParse({ callId: 'a', result: { kind: 'library', ok: 'yes' } }).success).toBe(false)
  })
})
