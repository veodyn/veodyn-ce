// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureDescriptor } from '@/features/types'
import type { SidecarTransport } from '@/lib/chat/sidecar-transport'
import type { RedashTransport } from '@/lib/chat/transport'

const runner = vi.hoisted(() => vi.fn())

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      chatTools: [
        { tool: 'show_kpi', execute: async () => ({ default: runner }) },
        { tool: 'update_kpi', resultKind: 'kpi_edit_check', execute: async () => ({ default: runner }) },
      ],
    },
  }
  return { FEATURES }
})

import { runClientCall } from './run-client-call'

const signal = new AbortController().signal
const FEATURE_FLAGS = { queryDrafts: false }
const transport = { get: vi.fn(), post: vi.fn(), del: vi.fn() } as unknown as RedashTransport
const sidecar: SidecarTransport = { get: vi.fn(), post: vi.fn(), patch: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MCP running a contributed tool', () => {
  it('runs a tool only a pack names with the server transports and returns its result', async () => {
    const edited = { kind: 'kpi_edit_check', ok: true, kpiId: 'otp' }
    runner.mockResolvedValue(edited)

    const result = await runClientCall(
      { tool: 'update_kpi', args: { kpiId: 'otp', changes: { target: 5 } } },
      transport,
      signal,
      FEATURE_FLAGS,
      { sidecar }
    )

    expect(result).toEqual(edited)
    expect(runner).toHaveBeenCalledWith({ kpiId: 'otp', changes: { target: 5 } }, signal, transport, { sidecar })
  })

  it('runs the KPI read tools too, so they no longer refuse outside the app', async () => {
    runner.mockResolvedValue({ kind: 'kpi', ok: true })
    const result = await runClientCall({ tool: 'show_kpi', args: { kpiId: 'otp' } }, transport, signal, FEATURE_FLAGS, {
      sidecar,
    })
    expect(result).toEqual({ kind: 'kpi', ok: true })
  })

  it('answers a failure of the declared kind when the runner throws', async () => {
    runner.mockRejectedValue(new Error('sidecar unreachable'))
    const result = await runClientCall({ tool: 'update_kpi', args: {} }, transport, signal, FEATURE_FLAGS, { sidecar })
    expect(result).toEqual({ kind: 'kpi_edit_check', ok: false, error: 'sidecar unreachable' })
  })

  it('answers a runner that returns the wrong kind with a failure of the declared kind', async () => {
    runner.mockResolvedValue({ kind: 'kpi', ok: true })
    const result = await runClientCall({ tool: 'update_kpi', args: {} }, transport, signal, FEATURE_FLAGS, { sidecar })
    expect(result).toMatchObject({ kind: 'kpi_edit_check', ok: false })
  })

  it('has no sidecar to offer when none is passed, and says so instead of crashing', async () => {
    runner.mockImplementation(async (_args, _signal, _transport, context) => {
      await context.sidecar.get('kpis')
      return { kind: 'kpi_edit_check', ok: true }
    })
    const result = await runClientCall({ tool: 'update_kpi', args: {} }, transport, signal, FEATURE_FLAGS)
    expect(result).toMatchObject({ kind: 'kpi_edit_check', ok: false })
  })

  it('returns null for a pack tool no installed feature runs', async () => {
    expect(await runClientCall({ tool: 'approve_report', args: {} }, transport, signal, FEATURE_FLAGS, { sidecar })).toBeNull()
  })

  it('resolves the snippet and KPI checks the community owns', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === 'query_snippets/3') {
        return { id: 3, trigger: 'dt', description: '', snippet: 's', user: { id: 1 }, updated_at: 'x' }
      }
      if (path === 'session') return { user: { id: 1, permissions: [] } }
      throw new Error(`unexpected ${path}`)
    })
    const server = { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport
    const result = await runClientCall({ tool: 'delete_snippet', args: { snippetId: 3 } }, server, signal, FEATURE_FLAGS)
    expect(result).toMatchObject({ kind: 'snippet_check', ok: true, mode: 'delete', snippetId: 3 })

    const draft = await runClientCall(
      {
        tool: 'propose_kpi',
        args: {
          name: 'n',
          description: '',
          sourceQueryId: null,
          queryDraftId: 'd1',
          valueColumn: 'v',
          unit: null,
          target: 1,
          direction: 'higher-is-better',
          cadence: 'daily',
          atRisk: null,
          breached: null,
        },
      },
      server,
      signal,
      FEATURE_FLAGS
    )
    expect(draft).toMatchObject({ kind: 'kpi_check', ok: true, queryDraftId: 'd1', columns: [] })
  })
})
