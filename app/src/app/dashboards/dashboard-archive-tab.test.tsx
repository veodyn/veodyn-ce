// The Archive tab on /dashboards, and the way back off it.
//
// Archiving a dashboard used to be unreachable from the UI, and the backend
// listing hides archived rows unconditionally, so anything archived through the
// API was gone for good. These run against the real-API path so the assertions
// are about what goes on the wire, not about what the mock store happens to do.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { mockDashboards, type MockDashboard } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardsPage from '@/app/dashboards/page'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

// Which tab is on screen is a URL question, and these tests ask it more than
// once, so it lives in a box the mock reads at render time.
const route = vi.hoisted(() => ({ tab: 'archive' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${route.tab}`),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: toastError, success: toastSuccess }) }
})

const LIVE_NAME = 'Transit Overview'
const ARCHIVED_NAME = 'Retired Fleet Report'

// Who created these dashboards. Removal is owner-or-admin and ownership is an
// id comparison, so the author is a user object on the row rather than a flag.
const AUTHOR = { id: 501, name: 'Dana Author', email: 'dana@example.com' }
const STRANGER_ID = 502
const ADMIN_ID = 503

function fixture(overrides: Partial<MockDashboard>): MockDashboard {
  return {
    ...mockDashboards[0],
    widgets: [],
    tags: [],
    can_edit: true,
    user: AUTHOR,
    ...overrides,
  }
}

// Built the way the session response builds it, so isAdmin comes off the
// permission list and canEdit is the real function the row menu calls.
function signIn(id: number, isAdmin: boolean) {
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({
      id,
      name: `User ${id}`,
      email: `user-${id}@example.com`,
      permissions: isAdmin ? ['admin', 'list_dashboards'] : ['list_dashboards', 'edit_dashboard'],
    }),
  })
}

const signInAsAuthor = () => signIn(AUTHOR.id, false)
const signInAsStranger = () => signIn(STRANGER_ID, false)
const signInAsAdmin = () => signIn(ADMIN_ID, true)

// One set of rows behind every listing, filtered the way the backend filters
// it: Dashboard.all drops is_archived rows and the archive resource is its
// mirror image. A tab that read the wrong endpoint would show the wrong rows.
let rows: MockDashboard[] = []

function envelope(results: MockDashboard[]) {
  return HttpResponse.json({ count: results.length, page: 1, page_size: 100, results })
}

function installListings() {
  server.use(
    http.get('/api/node/dashboards', () => envelope(rows.filter((d) => !d.is_archived))),
    http.get('/api/node/dashboards/archive', () => envelope(rows.filter((d) => d.is_archived))),
    http.get('/api/node/dashboards/my', () => envelope(rows.filter((d) => !d.is_archived))),
    http.get('/api/node/dashboards/favorites', () => envelope([]))
  )
}

// AI off is the demo posture and the one every test here cares about: the
// Create-with-AI button renders null, so the page is exactly the page it was.
function renderDashboardsPage(): RenderResult {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: false } }}>
      <DashboardsPage />
    </ConfigProvider>
  )
}

beforeEach(() => {
  route.tab = 'archive'
  toastError.mockClear()
  toastSuccess.mockClear()
  // The author is the default viewer: the archive and restore mechanics below
  // are about what goes on the wire, and only someone who may act gets there.
  signInAsAuthor()
  rows = [
    fixture({ id: 1, name: LIVE_NAME, is_archived: false }),
    fixture({ id: 4, name: ARCHIVED_NAME, is_archived: true }),
  ]
  installListings()
})

afterEach(() => resetStores())

describe('the dashboards Archive tab', () => {
  it('lists an archived dashboard, which no other tab shows', async () => {
    renderDashboardsPage()

    expect(await screen.findByText(ARCHIVED_NAME)).toBeInTheDocument()
    expect(screen.queryByText(LIVE_NAME)).not.toBeInTheDocument()
  })

  it('keeps the archived dashboard off the All tab', async () => {
    route.tab = 'all'
    renderDashboardsPage()

    expect(await screen.findByText(LIVE_NAME)).toBeInTheDocument()
    expect(screen.queryByText(ARCHIVED_NAME)).not.toBeInTheDocument()
  })

  it('restores a dashboard and puts it back on the All tab', async () => {
    const user = userEvent.setup()
    let body: unknown
    server.use(
      http.post('/api/node/dashboards/4', async ({ request }) => {
        body = await request.json()
        // Stands in for the backend write, so the listings that follow are
        // answering from the state the request actually produced.
        rows = rows.map((d) => (d.id === 4 ? { ...d, is_archived: false } : d))
        return HttpResponse.json({ ...rows[1], is_archived: false })
      })
    )

    const view = renderDashboardsPage()
    await user.click(await screen.findByRole('button', { name: `Actions for ${ARCHIVED_NAME}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }))

    // Redash exposes no unarchive endpoint; is_archived is an ordinary field
    // its update handler does not strip.
    await waitFor(() => expect(body).toEqual({ is_archived: false }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())

    view.unmount()
    route.tab = 'all'
    renderDashboardsPage()

    expect(await screen.findByText(ARCHIVED_NAME)).toBeInTheDocument()
  })

  it('reports a refused restore rather than appearing to succeed', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/node/dashboards/4', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
      )
    )

    renderDashboardsPage()
    await user.click(await screen.findByRole('button', { name: `Actions for ${ARCHIVED_NAME}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

// Who is offered a dashboard row action, and it is not what the server would
// allow. DashboardResource.delete carries @require_permission("edit_dashboard")
// and no ownership test at all (handlers/dashboards.py), so on the server a
// colleague holding that group permission can archive anyone's dashboard. This
// UI is deliberately stricter: owner or admin, the same sentence that covers
// all five library types. The stranger below holds edit_dashboard and is still
// offered nothing, which is the point.
//
// can_edit is not the rule either, and is not even in this payload: Redash
// attaches it in DashboardResource.get only (handlers/dashboards.py:227) and
// DashboardSerializer never emits it. Each row below carries a can_edit that
// disagrees with the expected outcome, so a gate that read it would fail here.
describe('who is offered a dashboard row action', () => {
  it('offers it to the author, who is not an admin', async () => {
    renderDashboardsPage()

    expect(
      await screen.findByRole('button', { name: `Actions for ${ARCHIVED_NAME}` })
    ).toBeInTheDocument()
  })

  it('offers nothing to someone who did not create it', async () => {
    signInAsStranger()
    rows = [fixture({ id: 4, name: ARCHIVED_NAME, is_archived: true, can_edit: true })]
    installListings()

    renderDashboardsPage()

    expect(await screen.findByText(ARCHIVED_NAME)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Actions for ${ARCHIVED_NAME}` })
    ).not.toBeInTheDocument()
  })

  it('offers it to an admin who did not create it', async () => {
    signInAsAdmin()
    rows = [fixture({ id: 4, name: ARCHIVED_NAME, is_archived: true, can_edit: false })]
    installListings()

    renderDashboardsPage()

    expect(
      await screen.findByRole('button', { name: `Actions for ${ARCHIVED_NAME}` })
    ).toBeInTheDocument()
  })
})

describe('archiving from a dashboards list row', () => {
  it('archives only once the confirmation is accepted', async () => {
    const user = userEvent.setup()
    route.tab = 'all'
    let deleted = false
    server.use(
      http.delete('/api/node/dashboards/1', () => {
        deleted = true
        rows = rows.map((d) => (d.id === 1 ? { ...d, is_archived: true } : d))
        // DashboardResource.delete answers with the archived dashboard, not an
        // empty 204. An empty body here would make the client's own JSON parse
        // throw and the test would be asserting against a failure path.
        return HttpResponse.json(rows.find((d) => d.id === 1))
      })
    )

    renderDashboardsPage()
    await user.click(await screen.findByRole('button', { name: `Actions for ${LIVE_NAME}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    // Opening the item must not have written anything. Queries used to archive
    // on one unconfirmed click, which is the regression this guards.
    expect(deleted).toBe(false)
    expect(await screen.findByText(`Archive "${LIVE_NAME}"?`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    // Redash's DELETE archives; there is no hard delete to reach for.
    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('leaves the row where it is when the archive is refused', async () => {
    const user = userEvent.setup()
    route.tab = 'all'
    server.use(
      http.delete('/api/node/dashboards/1', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
      )
    )

    renderDashboardsPage()
    await user.click(await screen.findByRole('button', { name: `Actions for ${LIVE_NAME}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    await user.click(await screen.findByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByText(LIVE_NAME)).toBeInTheDocument()
  })
})
