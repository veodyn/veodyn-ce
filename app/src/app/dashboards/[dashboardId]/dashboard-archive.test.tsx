// Archiving a dashboard from its own page. There was no way to do this at all:
// the mutation, the service call and the proxy route all existed and the header
// carried a kebab with nothing behind it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockDashboards, type MockDashboard } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardViewPage from '@/app/dashboards/[dashboardId]/page'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const DASHBOARD_ID = 8181
const NAME = 'Transit Overview'

// Who created this dashboard. Removal is owner-or-admin and ownership is an id
// comparison, so the author has to be a user object on the dashboard itself.
const AUTHOR = { id: 501, name: 'Dana Author', email: 'dana@example.com' }
const STRANGER_ID = 502
const ADMIN_ID = 503

function seedDashboard(overrides: Partial<MockDashboard> = {}) {
  const dashboard: MockDashboard = {
    ...mockDashboards[0],
    id: DASHBOARD_ID,
    name: NAME,
    // Still true, and still load-bearing: the page reads can_edit for the tag
    // editor. It is deliberately not what gates the archive.
    can_edit: true,
    is_archived: false,
    user: AUTHOR,
    // No widgets: nothing here is about the grid, and each widget pulls a query
    // result behind it.
    widgets: [],
    tags: [],
    ...overrides,
  }
  useMockDataStore.setState({ dashboards: [dashboard] })
}

/** What the write left behind, rather than what the component claims it sent. */
function storedArchived(): boolean | undefined {
  return useMockDataStore.getState().dashboards.find((d) => d.id === DASHBOARD_ID)?.is_archived
}

// Built the way the session response builds it, so isAdmin comes off the
// permission list and canEdit is the real function the header calls.
function signIn(id: number, isAdmin: boolean) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
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

async function renderPage() {
  await act(async () => {
    renderWithProviders(
      <DashboardViewPage params={Promise.resolve({ dashboardId: String(DASHBOARD_ID) })} />
    )
  })
}

const menuName = `Actions for ${NAME}`

beforeEach(() => {
  push.mockClear()
  resetStores()
  // The author is the default viewer: the confirmation and navigation tests
  // below are about what happens after the action is offered.
  signInAsAuthor()
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ dashboards: mockDashboards })
})

describe('archiving a dashboard from its detail page', () => {
  it('archives only once the confirmation is accepted', async () => {
    const user = userEvent.setup()
    seedDashboard()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: menuName }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    // The whole point of the dialog. Opening the menu item must not have
    // written anything yet, and it must not have navigated away either.
    expect(storedArchived()).toBe(false)
    expect(push).not.toHaveBeenCalled()

    // The copy comes from lib/removal, so the dialog cannot drift from the row
    // menu's promise that this is recoverable.
    expect(await screen.findByText(`Archive "${NAME}"?`)).toBeInTheDocument()
    expect(screen.getByText(/restore it from the Archive tab/i)).toBeInTheDocument()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Archive' }))
    })

    expect(storedArchived()).toBe(true)
  })

  it('leaves for the list once the dashboard is archived', async () => {
    // The object it was showing has just dropped out of every listing, so
    // staying put would leave the reader on a page that no longer resolves.
    const user = userEvent.setup()
    seedDashboard()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: menuName }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Archive' }))
    })

    expect(push).toHaveBeenCalledWith('/dashboards')
  })

  // Who the header offers the action to. On the server, DashboardResource.delete
  // is @require_permission("edit_dashboard") with no ownership test at all, so
  // any colleague in a group carrying that permission could archive this. The
  // client is deliberately stricter and asks owner-or-admin instead: erring
  // closed keeps every library type explainable by one sentence, and a colleague
  // silently archiving your dashboard is not what this feature is for. The
  // stranger below holds edit_dashboard and is still offered nothing.
  //
  // can_edit is not the rule. It stays true on the fixture because the page
  // reads it for the tag editor, and because a gate that read it would then have
  // to fail this test rather than pass it.
  it('offers nothing for a dashboard this person did not create', async () => {
    signInAsStranger()
    seedDashboard({ can_edit: true })
    await renderPage()

    // The rest of the header is untouched: this is about the removal menu, not
    // about locking someone out of the page.
    expect(await screen.findByRole('button', { name: /^Edit$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: menuName })).not.toBeInTheDocument()
  })

  it('offers the action to an admin who did not create it', async () => {
    signInAsAdmin()
    seedDashboard({ can_edit: false })
    await renderPage()

    expect(await screen.findByRole('button', { name: menuName })).toBeInTheDocument()
  })
})
