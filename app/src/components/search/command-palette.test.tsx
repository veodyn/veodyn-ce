import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPalette } from '@/components/search/command-palette'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import { useAuthStore, type CurrentUser, type Permission } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { SEARCH_PLACEHOLDER } from '@/components/home/omnisearch-input'
import * as useFederatedSearchModule from '@/hooks/use-federated-search'
import type { MockQuery, MockDashboard } from '@/lib/mock-data'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/',
}))

// Partial mock: wrap the real hook in a vi.fn so this file can assert what
// query it was called with (the open/closed gate below), while the
// federation test further down still exercises the real TanStack Query path.
vi.mock('@/hooks/use-federated-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-federated-search')>()
  return { ...actual, useFederatedSearch: vi.fn(actual.useFederatedSearch) }
})
const useFederatedSearchSpy = vi.mocked(useFederatedSearchModule.useFederatedSearch)

const permissions: Permission[] = ['view_query', 'list_dashboards']
const mockUser: CurrentUser = {
  id: 1, name: 'Test User', email: 'test@example.com', profile_image_url: '',
  groups: [2], api_key: 'k', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', is_disabled: false,
  is_invitation_pending: false, active_at: '2026-01-01T00:00:00Z',
  is_email_verified: true, auth_type: 'password', permissions, isAdmin: false,
  hasPermission: (p) => permissions.includes(p), canEdit: () => false, canCreate: () => true,
}

function makeQuery(id: number, name: string): MockQuery {
  return {
    id, name, description: '', query: 'select 1', data_source_id: 1, schedule: null,
    tags: [], is_archived: false, is_draft: false, is_favorite: false, is_safe: true,
    can_edit: true, user: { id: 1, name: 'A', email: 'a@example.com' },
    last_modified_by: { id: 1, name: 'A', email: 'a@example.com' }, visualizations: [],
    latest_query_data_id: null, options: { parameters: [] },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    retrieved_at: '', runtime: 0, version: 1,
  }
}
function makeDashboard(id: number, name: string): MockDashboard {
  return {
    id, name, slug: `d-${id}`, tags: [], is_archived: false, is_draft: false,
    is_favorite: false, can_edit: true, user: { id: 1, name: 'A', email: 'a@example.com' },
    widgets: [], dashboard_filters_enabled: false, created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z', public_url: null, api_key: null, version: 1,
  }
}

function tree(
  open: boolean,
  client: QueryClient,
  onOpenChange: (open: boolean) => void = () => {}
) {
  return (
    <QueryClientProvider client={client}>
      <ConfigProvider value={toClientConfig(NEUTRAL_CONFIG)}>
        <CommandPalette open={open} onOpenChange={onOpenChange} />
      </ConfigProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  // The mock store seeds catalog datasets by default (e.g. the "Bus
  // Ridership (Daily)" fixture), which would otherwise leak into the "bus"
  // queries below since this file exercises the real federation search.
  useMockDataStore.setState({ queries: [], dashboards: [], datasets: [] })
})

afterEach(() => {
  push.mockClear()
  useFederatedSearchSpy.mockClear()
  useMockDataStore.setState({ queries: [], dashboards: [], datasets: [] })
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
})

describe('CommandPalette', () => {
  it('lists static navigation commands grouped by sidebar section', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(tree(true, client))
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('LIBRARY')).toBeInTheDocument()
    expect(screen.getByText('Dashboards')).toBeInTheDocument()
  })

  it('stops the federation query once the palette closes', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    useMockDataStore.setState({ queries: [makeQuery(1, 'Bus ridership')] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(tree(true, client))
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'bus')
    await screen.findByText('Bus ridership')

    rerender(tree(false, client))

    // CommandPalette keeps rendering (and its hooks keep firing) while closed,
    // so the query itself, not just the dialog's DOM output, must go idle.
    expect(useFederatedSearchSpy).toHaveBeenLastCalledWith('')
  })

  it('runs the federation and navigates to a selected result', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    useMockDataStore.setState({
      queries: [makeQuery(1, 'Bus ridership')],
      dashboards: [makeDashboard(2, 'Bus dashboard')],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onOpenChange = vi.fn()
    render(tree(true, client, onOpenChange))
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'bus')

    const result = await screen.findByText('Bus ridership')
    const dash = await screen.findByText('Bus dashboard')
    expect(result).toBeInTheDocument()
    expect(dash).toBeInTheDocument()

    await user.click(result)
    expect(push).toHaveBeenCalledWith('/queries/1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows the empty state when neither nav commands nor results match', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    useMockDataStore.setState({
      queries: [makeQuery(1, 'Bus ridership')],
      dashboards: [makeDashboard(2, 'Bus dashboard')],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(tree(true, client))
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'nonexistentterm')

    expect(await screen.findByText('No results.')).toBeInTheDocument()
    expect(screen.queryByText('Bus ridership')).not.toBeInTheDocument()
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
  })
})
