// Widget writes with no backend. The dashboard read is asserted through the
// app's own useDashboard, so each test covers the store write AND the
// invalidation that has to follow it: a widget written into the store that the
// board never refetches is invisible until a reload, which is the same bug from
// the user's side as not writing it at all.
//
// The failure branch is the subject as much as the happy path. Every one of
// these mutations takes a dashboardId from the caller and has to do something
// sane when no such dashboard is in the store, rather than write a widget into
// nothing and report success.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockDashboard, MockDashboardWidget } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useDashboard } from './use-dashboards'
import { useCreateWidget, useDeleteWidget, useSaveLayout, useUpdateWidget } from './use-widgets'

const DASHBOARD_ID = 900
const MISSING_ID = 901

function widget(id: number, overrides: Partial<MockDashboardWidget> = {}): MockDashboardWidget {
  return {
    id,
    dashboard_id: DASHBOARD_ID,
    text: `widget ${id}`,
    width: 1,
    options: {
      position: { col: 0, row: id, sizeX: 3, sizeY: 8 },
      parameterMappings: { route: { name: 'route', type: 'dashboard-level' } },
      isHidden: false,
    },
    ...overrides,
  } as MockDashboardWidget
}

function dashboard(widgets: MockDashboardWidget[]): MockDashboard {
  return {
    id: DASHBOARD_ID,
    name: 'Fleet overview',
    slug: 'fleet-overview',
    tags: [],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    can_edit: true,
    user: { id: 1, name: 'Dana', email: 'dana@example.test', profile_image_url: '' },
    widgets,
    dashboard_filters_enabled: true,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    public_url: null,
    api_key: null,
  } as MockDashboard
}

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const { result } = renderHook(
    () => ({
      board: useDashboard(DASHBOARD_ID),
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
  await waitFor(() => expect(h.result.current.board.isSuccess).toBe(true))
  return h
}

function storedWidgets() {
  return useMockDataStore.getState().dashboards.find((d) => d.id === DASHBOARD_ID)?.widgets ?? []
}

beforeEach(() => {
  useMockDataStore.setState({ dashboards: [dashboard([widget(1), widget(2)])] })
})

describe('adding a widget with no backend', () => {
  it('shows up on the board without a reload', async () => {
    const { result } = await settled()
    expect(result.current.board.data?.widgets).toHaveLength(2)

    await act(async () => {
      await result.current.create.mutateAsync({ dashboardId: DASHBOARD_ID, text: 'Notes' })
    })

    await waitFor(() => expect(result.current.board.data?.widgets).toHaveLength(3))
    expect(result.current.board.data?.widgets.at(-1)?.text).toBe('Notes')
  })

  it('keeps the widgets that were already there', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.create.mutateAsync({ dashboardId: DASHBOARD_ID, text: 'Notes' })
    })

    await waitFor(() => expect(storedWidgets()).toHaveLength(3))
    expect(storedWidgets().slice(0, 2).map((w) => w.id)).toEqual([1, 2])
  })

  it('defaults the position rather than leaving the grid without one', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.create.mutateAsync({ dashboardId: DASHBOARD_ID, text: 'Notes' })
    })

    await waitFor(() => expect(storedWidgets()).toHaveLength(3))
    expect(storedWidgets().at(-1)?.options.position).toEqual({ col: 0, row: 0, sizeX: 3, sizeY: 8 })
  })

  // Reported rather than swallowed: a create that resolves against a dashboard
  // that is not there would leave the caller closing its dialog on a widget
  // nothing stored.
  it('fails for a dashboard the store does not have', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.create.mutateAsync({ dashboardId: MISSING_ID, text: 'Notes' }).catch(() => {})
    })

    await waitFor(() => expect(result.current.create.isError).toBe(true))
    expect(result.current.create.error?.message).toContain('Dashboard not found')
    expect(storedWidgets()).toHaveLength(2)
  })
})

describe('editing and removing a widget with no backend', () => {
  it('changes only the widget that was edited', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.update.mutateAsync({
        dashboardId: DASHBOARD_ID,
        widgetId: 2,
        text: 'Edited',
      })
    })

    await waitFor(() => expect(storedWidgets()[1].text).toBe('Edited'))
    expect(storedWidgets()[0].text).toBe('widget 1')
    expect(storedWidgets()).toHaveLength(2)
  })

  it('leaves the untouched keys of the edited widget alone', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.update.mutateAsync({ dashboardId: DASHBOARD_ID, widgetId: 2, width: 3 })
    })

    await waitFor(() => expect(storedWidgets()[1].width).toBe(3))
    expect(storedWidgets()[1].options.parameterMappings).toEqual(widget(2).options.parameterMappings)
  })

  it('fails an edit against a dashboard the store does not have', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.update
        .mutateAsync({ dashboardId: MISSING_ID, widgetId: 2, text: 'Edited' })
        .catch(() => {})
    })

    await waitFor(() => expect(result.current.update.isError).toBe(true))
    expect(storedWidgets()[1].text).toBe('widget 2')
  })

  it('takes the widget off the board it was removed from', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.remove.mutateAsync({ dashboardId: DASHBOARD_ID, widgetId: 1 })
    })

    await waitFor(() => expect(result.current.board.data?.widgets.map((w) => w.id)).toEqual([2]))
  })

  it('removes nothing when the widget id matches none of them', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.remove.mutateAsync({ dashboardId: DASHBOARD_ID, widgetId: 99 })
    })

    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true))
    expect(storedWidgets().map((w) => w.id)).toEqual([1, 2])
  })

  it('fails a removal against a dashboard the store does not have', async () => {
    const { result } = await settled()

    await act(async () => {
      await result.current.remove
        .mutateAsync({ dashboardId: MISSING_ID, widgetId: 1 })
        .catch(() => {})
    })

    await waitFor(() => expect(result.current.remove.isError).toBe(true))
    expect(storedWidgets()).toHaveLength(2)
  })
})

describe('saving a layout with no backend', () => {
  // A drag reorders and resizes several widgets at once; the whole array is the
  // unit, and the board has to show the new grid straight away.
  it('replaces the whole widget array and re-renders the board', async () => {
    const { result } = await settled()
    const moved = [
      widget(2, { options: { ...widget(2).options, position: { col: 0, row: 0, sizeX: 6, sizeY: 8 } } }),
      widget(1),
    ]

    await act(async () => {
      await result.current.saveLayout.mutateAsync({ dashboardId: DASHBOARD_ID, widgets: moved })
    })

    await waitFor(() => expect(result.current.board.data?.widgets.map((w) => w.id)).toEqual([2, 1]))
    expect(storedWidgets()[0].options.position.sizeX).toBe(6)
  })
})
