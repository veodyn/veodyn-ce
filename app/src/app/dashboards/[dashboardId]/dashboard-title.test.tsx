import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'

// The page routes to the new report after "Promote to report", so it calls
// useRouter on every render and needs an app router in the test environment.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/hooks/use-dashboards', () => ({
  useDashboard: () => ({
    data: { id: 1, name: 'Transit Overview', tags: [], widgets: [] },
    isLoading: false,
  }),
  useUpdateDashboard: () => ({ mutate: vi.fn() }),
  // ShareDashboardDialog is mounted unconditionally by the page (visibility
  // is just its `open` prop), so it always calls these on render.
  useShareDashboard: () => ({ mutate: vi.fn() }),
  useUnshareDashboard: () => ({ mutate: vi.fn() }),
  // The header action cluster mounts the archive menu, which calls both of
  // these on every render whether or not it ends up drawing a control.
  useArchiveDashboard: () => ({ mutate: vi.fn(), isPending: false }),
  useUnarchiveDashboard: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-widgets', () => ({
  useCreateWidget: () => ({ mutate: vi.fn() }),
  useUpdateWidget: () => ({ mutate: vi.fn() }),
  useDeleteWidget: () => ({ mutate: vi.fn() }),
  useSaveLayout: () => ({ mutate: vi.fn() }),
}))

/**
 * A build with no feature packages, stated rather than inherited.
 *
 * The Present entry below is gated on `hasFeature('wall')`, so whether the page
 * offers it is a fact about which packages the tree installs, and this file
 * runs in two trees. Wrapping the real `hasFeature` against a named registry
 * rather than faking its answer, so the real lookup still runs, the same way
 * dashboard-view-actions.test.tsx does it next door.
 *
 * Only `hasFeature` is replaced. The slots the page mounts keep the real
 * registry, so a composed build still renders whatever it contributes to the
 * toolbar; what is pinned here is the gate, and nothing else moves.
 */
vi.mock('@/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features')>()
  return { ...actual, hasFeature: (id: string) => actual.hasFeature(id, {}) }
})

import DashboardViewPage from '@/app/dashboards/[dashboardId]/page'

describe('dashboard detail favorite', () => {
  // The dashboards list had a star per row and the detail page had none, so the
  // only way to star a dashboard was to navigate away from it.
  it('offers a favorite toggle beside the title', async () => {
    await act(async () => {
      renderWithProviders(<DashboardViewPage params={Promise.resolve({ dashboardId: '1' })} />)
    })

    expect(screen.getByRole('button', { name: 'Add to favorites' })).toBeInTheDocument()
  })
})

describe('dashboard detail title', () => {
  it('renders the dashboard name in the display serif', async () => {
    // DashboardViewPage reads `params` via React's `use()`, which suspends on
    // mount even for an already-resolved promise (a native Promise always
    // defers its .then callback to a microtask). Wrapping the render in an
    // awaited act() lets that microtask (and the Suspense retry it triggers)
    // flush before we assert; a bare renderWithProviders(...) call here leaves
    // the tree suspended indefinitely in this test environment.
    await act(async () => {
      renderWithProviders(<DashboardViewPage params={Promise.resolve({ dashboardId: '1' })} />)
    })
    // EditInPlace renders the value inside an element carrying its className.
    // renderWithProviders supplies the QueryClient that DashboardViewPage's
    // useQueryClient() needs (the use-* data hooks above are mocked, but the
    // page still calls useQueryClient directly, so a real provider is required).
    expect(screen.getByText('Transit Overview')).toHaveClass('font-display')
  })

  // /present belongs to the wall package, so a build without it has no such
  // route and the header must offer no way into one. Asserted at the page
  // rather than at the toolbar component (dashboard-view-actions.test.tsx pins
  // the gate itself) because the page is what a reader lands on, and a dead
  // link here is a reader clicking through to a 404. The registry is the one at
  // the top of this file, not the tree's, so the claim is the same wherever
  // this runs; dashboard-title.enterprise.test.tsx asserts the entry, and where
  // it goes, against a registry that really has the wall package in it.
  it('offers no way into the presentation route on a build with no wall package', async () => {
    await act(async () => {
      renderWithProviders(<DashboardViewPage params={Promise.resolve({ dashboardId: '1' })} />)
    })
    // Button with render={<Link/>} produces a real <a href> but base-ui stamps
    // role="button" on it, so the absent control is queried by the button role.
    expect(screen.queryByRole('button', { name: /present/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /present/i })).not.toBeInTheDocument()
  })
})
