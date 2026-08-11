// Widget writes against a real backend.
//
// Two things are pinned. First what reaches the service: Redash replaces a
// widget's `options` wholesale, and requires `visualization_id` to be present
// even when it is null, so a payload that drops either is a data loss the UI
// cannot see. Second which cached reads each write repairs: a widget lives
// inside its dashboard, so a write that heals only the list leaves the board
// the widget was just dropped onto showing the old grid.
//
// The dashboard reads are the app's own hooks, not hand-written query keys, so
// a mutation invalidating a key nobody reads fails here.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/widgets', () => ({
  createWidget: vi.fn(),
  updateWidget: vi.fn(),
  deleteWidget: vi.fn(),
}))
vi.mock('@/services/redash/dashboards', () => ({
  list: vi.fn(),
  get: vi.fn(),
}))

import type { MockDashboardWidget } from '@/lib/mock-data'
import * as dashboardsService from '@/services/redash/dashboards'
import * as widgetsService from '@/services/redash/widgets'
import { useDashboard, useDashboards } from './use-dashboards'
import { useCreateWidget, useDeleteWidget, useSaveLayout, useUpdateWidget } from './use-widgets'

const DASHBOARD_ID = 12
const OTHER_DASHBOARD_ID = 13

function widget(id: number, overrides: Partial<MockDashboardWidget> = {}): MockDashboardWidget {
  return {
    id,
    dashboard_id: DASHBOARD_ID,
    text: '',
    width: 1,
    options: {
      position: { col: 0, row: id, sizeX: 3, sizeY: 8 },
      parameterMappings: { route: { name: 'route', type: 'dashboard-level' } },
      isHidden: false,
    },
    ...overrides,
  } as MockDashboardWidget
}

/**
 * Both dashboard reads mounted alongside the writes, plus a second dashboard's
 * detail entry so "invalidated everything" is distinguishable from
 * "invalidated the right entry".
 */
function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const { result } = renderHook(
    () => ({
      list: useDashboards(),
      detail: useDashboard(DASHBOARD_ID),
      otherDetail: useDashboard(OTHER_DASHBOARD_ID),
      create: useCreateWidget(),
      update: useUpdateWidget(),
      remove: useDeleteWidget(),
      saveLayout: useSaveLayout(),
    }),
    { wrapper: Wrapper }
  )
  return { qc, result }
}

async function settled() {
  const h = harness()
  await waitFor(() => {
    expect(h.result.current.list.isSuccess).toBe(true)
    expect(h.result.current.detail.isSuccess).toBe(true)
    expect(h.result.current.otherDetail.isSuccess).toBe(true)
  })
  return h
}

function counts() {
  return {
    list: vi.mocked(dashboardsService.list).mock.calls.length,
    detail: vi.mocked(dashboardsService.get).mock.calls.filter((c) => c[0] === DASHBOARD_ID).length,
    other: vi.mocked(dashboardsService.get).mock.calls.filter((c) => c[0] === OTHER_DASHBOARD_ID).length,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dashboardsService.list).mockResolvedValue({ count: 0, page: 1, page_size: 25, results: [] })
  vi.mocked(dashboardsService.get).mockResolvedValue(null)
  vi.mocked(widgetsService.createWidget).mockResolvedValue(widget(1))
  vi.mocked(widgetsService.updateWidget).mockResolvedValue(undefined)
  vi.mocked(widgetsService.deleteWidget).mockResolvedValue(undefined)
})

describe('what a widget write puts on the wire', () => {
  // Redash requires the key to be present; a text widget sends it as null. An
  // omitted key is refused, which reads to the user as "adding a text box is
  // broken".
  it('sends a null visualization id for a text widget rather than omitting it', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.create.mutateAsync({ dashboardId: DASHBOARD_ID, text: 'Notes' })
    })

    const payload = vi.mocked(widgetsService.createWidget).mock.calls[0][0]
    expect('visualization_id' in payload).toBe(true)
    expect(payload.visualization_id).toBeNull()
    expect(payload.text).toBe('Notes')
  })

  it('carries the visualization id when one was chosen', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.create.mutateAsync({
        dashboardId: DASHBOARD_ID,
        visualization: { id: 77, name: 'Boardings' } as MockDashboardWidget['visualization'],
      })
    })

    expect(vi.mocked(widgetsService.createWidget).mock.calls[0][0].visualization_id).toBe(77)
  })

  it('gives a widget dropped with no options a default position rather than none', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.create.mutateAsync({ dashboardId: DASHBOARD_ID, text: 'Notes' })
    })

    const payload = vi.mocked(widgetsService.createWidget).mock.calls[0][0]
    expect(payload.options.position).toEqual({ col: 0, row: 0, sizeX: 3, sizeY: 8 })
    expect(payload.width).toBe(1)
  })

  // The guard exists because Redash REPLACES options: a partial object silently
  // drops parameterMappings and isHidden. Refusing the call is the only outcome
  // that does not lose the widget's parameter wiring.
  it('refuses an update that would replace options with nothing', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.update
        .mutateAsync({ dashboardId: DASHBOARD_ID, widgetId: 5, text: 'renamed' })
        .catch(() => {})
    })

    await waitFor(() => expect(result.current.update.isError).toBe(true))
    expect(result.current.update.error?.message).toContain('full options object')
    expect(vi.mocked(widgetsService.updateWidget)).not.toHaveBeenCalled()
  })

  it('passes the merged options through untouched when they are supplied', async () => {
    const { result } = await settled()
    const options = widget(5).options

    await act(async () => {
      await result.current.update.mutateAsync({
        dashboardId: DASHBOARD_ID,
        widgetId: 5,
        width: 2,
        options,
      })
    })

    expect(vi.mocked(widgetsService.updateWidget)).toHaveBeenCalledWith(5, {
      text: undefined,
      width: 2,
      options,
    })
  })

  // A drag moves more than the widget under the cursor: everything that
  // reflowed has to be written, or the next read snaps them back.
  it('writes every widget in the layout, each with its own options', async () => {
    const { result } = await settled()
    const widgets = [widget(1), widget(2), widget(3)]

    await act(async () => {
      await result.current.saveLayout.mutateAsync({ dashboardId: DASHBOARD_ID, widgets })
    })

    expect(vi.mocked(widgetsService.updateWidget).mock.calls.map((c) => c[0])).toEqual([1, 2, 3])
    expect(vi.mocked(widgetsService.updateWidget).mock.calls[1][1].options).toEqual(widget(2).options)
  })

  it('fails the layout save when one widget in it is refused', async () => {
    const { result } = await settled()
    vi.mocked(widgetsService.updateWidget).mockImplementation(async (id: number) => {
      if (id === 2) throw new Error('409')
    })

    await act(async () => {
      await result.current.saveLayout
        .mutateAsync({ dashboardId: DASHBOARD_ID, widgets: [widget(1), widget(2)] })
        .catch(() => {})
    })

    await waitFor(() => expect(result.current.saveLayout.isError).toBe(true))
  })
})

describe('which dashboard reads a widget write repairs', () => {
  async function expectRepairsBoth(run: () => Promise<unknown>) {
    const before = counts()
    await act(async () => {
      await run()
    })
    await waitFor(() => expect(counts().detail).toBe(before.detail + 1))
    expect(counts().list).toBe(before.list + 1)
    // A sibling board that did not change must not be refetched.
    expect(counts().other).toBe(before.other)
  }

  it('refreshes the list and the board a widget was added to', async () => {
    const { result } = await settled()
    await expectRepairsBoth(() =>
      result.current.create.mutateAsync({ dashboardId: DASHBOARD_ID, text: 'Notes' })
    )
  })

  it('refreshes the list and the board a widget was edited on', async () => {
    const { result } = await settled()
    await expectRepairsBoth(() =>
      result.current.update.mutateAsync({
        dashboardId: DASHBOARD_ID,
        widgetId: 5,
        options: widget(5).options,
      })
    )
  })

  it('refreshes the list and the board a widget was removed from', async () => {
    const { result } = await settled()
    await expectRepairsBoth(() =>
      result.current.remove.mutateAsync({ dashboardId: DASHBOARD_ID, widgetId: 5 })
    )
    expect(vi.mocked(widgetsService.deleteWidget)).toHaveBeenCalledWith(5)
  })

  it('refreshes the list and the board a layout was saved on', async () => {
    const { result } = await settled()
    await expectRepairsBoth(() =>
      result.current.saveLayout.mutateAsync({ dashboardId: DASHBOARD_ID, widgets: [widget(1)] })
    )
  })

  it('refreshes nothing when the write was refused', async () => {
    const { result } = await settled()
    vi.mocked(widgetsService.deleteWidget).mockRejectedValue(new Error('403'))
    const before = counts()

    await act(async () => {
      await result.current.remove
        .mutateAsync({ dashboardId: DASHBOARD_ID, widgetId: 5 })
        .catch(() => {})
    })

    await waitFor(() => expect(result.current.remove.isError).toBe(true))
    expect(counts()).toEqual(before)
  })
})
