// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { RedashTransport } from '@/lib/chat/transport'
import { runClientCall } from './run-client-call'
import { installsNoFeaturePackages } from '@/features'

const signal = new AbortController().signal
const FEATURES = { queryDrafts: false }

function transportOf(handlers: Record<string, unknown>): RedashTransport {
  const get = vi.fn(async (path: string) => {
    if (path in handlers) return handlers[path]
    throw new Error(`unexpected ${path}`)
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport
}

describe('runClientCall', () => {
  it('runs a library tool on the transport', async () => {
    const transport = transportOf({
      data_sources: [{ id: 3, name: 'W', type: 'pg', syntax: 'sql', view_only: false }],
    })

    const result = await runClientCall({ tool: 'list_data_sources', args: {} }, transport, signal, FEATURES)

    expect(result).toMatchObject({ kind: 'data_sources', ok: true })
  })

  it.skipIf(!installsNoFeaturePackages())('answers a contributed tool with a refusal of the kind the sidecar expects', async () => {
    const result = await runClientCall({ tool: 'list_kpis', args: {} }, transportOf({}), signal, FEATURES)

    expect(result).toEqual({ kind: 'kpi_list', ok: false, error: 'This tool cannot run outside the app.' })
  })

  it('answers arguments that do not parse with a failure of the tool kind', async () => {
    const result = await runClientCall(
      { tool: 'open_query', args: { queryId: 'seven' } },
      transportOf({}),
      signal,
      FEATURES
    )

    expect(result).toMatchObject({ kind: 'query_detail', ok: false })
  })

  it('returns null for a tool this build has never heard of', async () => {
    expect(await runClientCall({ tool: 'mystery', args: {} }, transportOf({}), signal, FEATURES)).toBeNull()
  })

  it('turns a failed ad hoc run into a query_result failure', async () => {
    const transport = {
      get: vi.fn(),
      post: vi.fn(async () => {
        throw new Error('syntax error near FROM')
      }),
      del: vi.fn(),
    } as unknown as RedashTransport

    const result = await runClientCall(
      {
        tool: 'run_query',
        args: { dataSourceId: 3, sql: 'select', purpose: 'run_query', vizChoiceId: 'table' },
      },
      transport,
      signal,
      FEATURES
    )

    expect(result).toMatchObject({ kind: 'query_result', ok: false })
  })

  it('describes a visualization type without touching the transport', async () => {
    const transport = transportOf({})

    const result = await runClientCall({ tool: 'describe_visualization_type', args: { type: 'CHART' } }, transport, signal, FEATURES)

    expect(result).toMatchObject({ kind: 'visualization_type', ok: true, type: 'CHART' })
    expect(transport.get).not.toHaveBeenCalled()
  })

  it('resolves update_visualization on the transport with the column check', async () => {
    const transport = transportOf({
      'queries/5': {
        id: 5,
        is_archived: false,
        can_edit: true,
        latest_query_data_id: 90,
        visualizations: [
          { id: 11, type: 'CHART', name: 'Bars', options: { globalSeriesType: 'bar' }, updated_at: 'u' },
        ],
      },
      'query_results/90': { query_result: { data: { columns: [{ name: 'day' }], rows: [] } } },
    })

    const result = await runClientCall(
      {
        tool: 'update_visualization',
        args: { queryId: 5, visualizationId: 11, set: [{ path: 'columnMapping.missing', value: 'y' }] },
      },
      transport,
      signal,
      FEATURES
    )

    expect(result).toMatchObject({
      kind: 'visualization_check',
      ok: true,
      mode: 'edit',
      problems: ['columnMapping: no column named missing'],
    })
  })

  it('answers unreadable visualization arguments with a failure of the check kind', async () => {
    const result = await runClientCall(
      { tool: 'delete_visualization', args: { visualizationId: 'x' } },
      transportOf({}),
      signal,
      FEATURES
    )

    expect(result).toMatchObject({ kind: 'visualization_check', ok: false })
  })

  it('resolves update_dashboard on the transport into a dashboard_edit result', async () => {
    const transport = transportOf({
      'dashboards/4': {
        id: 4,
        name: 'Ops',
        tags: [],
        can_edit: true,
        is_archived: false,
        updated_at: 'u',
        widgets: [{ id: 2, dashboard_id: 4, text: 'hello', width: 1, options: { position: { col: 0, row: 0, sizeX: 6, sizeY: 4 } }, updated_at: 'w2' }],
      },
    })

    const result = await runClientCall(
      { tool: 'update_dashboard', args: { dashboardId: 4, operations: [{ op: 'remove', widgetId: 2 }] } },
      transport,
      signal,
      FEATURES
    )

    expect(result).toMatchObject({
      kind: 'dashboard_edit',
      ok: true,
      dashboardId: 4,
      operations: [{ op: 'remove', widgetId: 2, title: 'hello', updatedAt: 'w2' }],
    })
  })

  it('answers unreadable update_dashboard arguments with a failure of the edit kind', async () => {
    const result = await runClientCall(
      { tool: 'update_dashboard', args: { dashboardId: 4, operations: [{ op: 'explode' }] } },
      transportOf({}),
      signal,
      FEATURES
    )

    expect(result).toMatchObject({ kind: 'dashboard_edit', ok: false })
  })
})
