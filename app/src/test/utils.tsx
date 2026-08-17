import { ReactElement } from 'react'
import { render, RenderResult } from '@testing-library/react'
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig, type ClientConfig } from '@/lib/config-schema'
import { useAuthStore, type CurrentUser, type Permission } from '@/stores/auth-store'
import { mockPublishAttempts, mockPublishedFeeds, mockUsers } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'

export function resetStores() {
  // Reset Zustand singletons to an authenticated baseline so tests are isolated.
  // currentUser is cleared too: it is a singleton like the rest, and leaving it
  // behind let a test that signed a user in decide the result of a later test
  // that expected nobody signed in.
  useAuthStore.setState({ isAuthenticated: false, isLoading: false, currentUser: null })
  // The mock data store is a singleton too. Access grants in particular are
  // written by the permissions dialog in mock mode, so without this one test's
  // grant would decide the next test's starting state. Published feeds and
  // their attempts are the same story: recordPublishAttempt and the delete
  // mutation both write straight into this store, so a test that publishes or
  // deletes one leaves that mutation sitting for the next test unless it is
  // put back here. Both spreads are shallow, so the inner arrays are still the
  // fixture's own objects: what keeps that safe is that every slice mutation
  // REPLACES an array rather than pushing into one. A slice that starts editing
  // in place needs a deep copy here, or it edits the fixture for the whole run.
  useMockDataStore.setState({
    accessGrants: { queries: {}, dashboards: {} },
    publishedFeeds: [...mockPublishedFeeds],
    publishAttempts: { ...mockPublishAttempts },
  })
}

// Sign a test in as an administrator.
//
// `renderWithProviders` sets `isAuthenticated` but deliberately leaves
// `currentUser` null, which is fine until a screen gates a control on WHO you
// are rather than on whether you are signed in at all. Those gates read
// `currentUser`, so a test that never sets one is testing the signed-out path
// while looking like it tests the signed-in one.
//
// Admin rather than a specific owner because that is the shape most of these
// screens are written for, and because it makes the gate's owner branch the
// thing a test has to opt into explicitly. Pass `id` to sign in as a particular
// person when the test cares about ownership.
export function signInAsAdmin(overrides: Partial<CurrentUser> = {}): CurrentUser {
  const permissions: Permission[] = ['admin', 'create_query', 'create_dashboard']
  const admin: CurrentUser = {
    ...mockUsers[0],
    permissions,
    isAdmin: true,
    hasPermission: (permission) => permissions.includes(permission),
    canEdit: () => true,
    canCreate: () => true,
    ...overrides,
  }
  useAuthStore.setState({ currentUser: admin, isAuthenticated: true, isLoading: false })
  return admin
}

const NEUTRAL_CLIENT_CONFIG = toClientConfig(NEUTRAL_CONFIG)

// A page under test renders outside Next's router; the real page never does.
// `<Slot>` lets a feature contribute a component this tree cannot see, and one
// of those calling useRouter fails the community suite that renders the page,
// naming a component that suite never mentions.
//
// Navigating still throws, by name: a test that routes mocks next/navigation
// and asserts on it, which is the convention everywhere else here.
function refuses(method: string): never {
  throw new Error(`router.${method}() needs vi.mock('next/navigation') in this test`)
}

const STUB_ROUTER: AppRouterInstance = {
  push: () => refuses('push'),
  replace: () => refuses('replace'),
  back: () => refuses('back'),
  forward: () => refuses('forward'),
  refresh: () => refuses('refresh'),
  prefetch: () => {},
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { authenticated?: boolean; config?: Partial<ClientConfig> } = {}
): RenderResult {
  const { authenticated = true, config } = opts
  useAuthStore.setState({ isAuthenticated: authenticated, isLoading: false })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  // Every tree gets a ConfigProvider, because useConfig THROWS without one.
  // Without this, adding a feature-flag read to any widely mounted component
  // takes out every sibling test that renders that tree, which has bitten this
  // repo more than once. Defaults are the neutral config, so a test only opts
  // in to the keys it actually cares about.
  const value: ClientConfig = config
    ? { ...NEUTRAL_CLIENT_CONFIG, ...config }
    : NEUTRAL_CLIENT_CONFIG

  // Passed as `wrapper` rather than wrapped around `ui` by hand, because
  // testing-library reapplies a wrapper on rerender and does NOT reapply hand
  // wrapping. With the manual form, `rerender(<Thing/>)` dropped every provider
  // and remounted the subtree, so state a test had just built up vanished for
  // no reason visible in the test.
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ConfigProvider value={value}>
        <AppRouterContext.Provider value={STUB_ROUTER}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </AppRouterContext.Provider>
      </ConfigProvider>
    )
  }

  return render(ui, { wrapper: Wrapper })
}
