// Collapsing the desktop rail to icons.
//
// The rail only ever had one width, which on a small screen spends 240px on
// labels the reader already knows. Collapsing hides the text without hiding the
// destinations: the labels stay in the accessible tree, so an icon rail is not
// a rail of unnamed buttons.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import { useAuthStore, type CurrentUser, type Permission } from '@/stores/auth-store'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/queries'),
}))

const permissions: Permission[] = ['view_query', 'list_dashboards', 'list_alerts']

const mockUser: CurrentUser = {
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  profile_image_url: '',
  groups: [2],
  api_key: 'test-key',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_disabled: false,
  is_invitation_pending: false,
  active_at: '2026-01-01T00:00:00Z',
  is_email_verified: true,
  auth_type: 'password',
  permissions,
  isAdmin: false,
  hasPermission: (permission) => permissions.includes(permission),
  canEdit: () => false,
  canCreate: () => true,
}

function renderSidebar() {
  return render(
    <ConfigProvider value={toClientConfig(NEUTRAL_CONFIG)}>
      <AppSidebar />
    </ConfigProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  useAuthStore.setState({ currentUser: mockUser })
})

afterEach(() => {
  window.localStorage.clear()
  useAuthStore.setState({ currentUser: null })
})

// The desktop rail is the one that collapses; the drawer renders the same body
// expanded, so a query has to be scoped to avoid matching both copies.
function rail(): HTMLElement {
  const aside = document.querySelector('aside')
  if (!aside) throw new Error('no desktop rail rendered')
  return aside as HTMLElement
}

// Tooltips portal out of the rail, and their text repeats the sr-only label of
// the item they belong to, so they have to be read off the popup itself rather
// than found by text.
function tooltipTexts(): string[] {
  return [...document.querySelectorAll('[data-slot="tooltip-content"]')].map(
    (popup) => popup.textContent ?? ''
  )
}

describe('sidebar collapse', () => {
  it('starts expanded and narrows on the toggle', async () => {
    const user = userEvent.setup()
    renderSidebar()

    expect(rail().className).toContain('md:w-60')
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)

    expect(rail().className).toContain('md:w-14')
    // The control now offers the way back, and says so.
    const expand = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')

    await user.click(expand)
    expect(rail().className).toContain('md:w-60')
  })

  it('keeps every destination named while collapsed', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    // Not "the text is gone": the link must still carry its name, or the rail
    // becomes a column of unlabelled icons for anyone not using their eyes.
    // The names are the rows every build has, one from a section group and one
    // from the account block below the divider, so what this proves is that
    // collapsing keeps a rendered row named wherever it sits. A build with
    // feature packages installed asserts the rows they contribute in its own
    // suite.
    for (const name of ['Queries', 'Dashboards', 'Profile']) {
      expect(within(rail()).getByRole('link', { name })).toBeInTheDocument()
    }
    // ...and the current route is still marked, which the background colour is
    // the only remaining carrier of.
    expect(within(rail()).getByRole('link', { name: 'Queries' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  // The sr-only label keeps the rail readable to a screen reader; the tooltip is
  // what a sighted person gets, and a `title` attribute was not it: browser
  // tooltips wait about a second, never follow the keyboard, and cannot be
  // styled to look like the rest of the app.
  it('names a collapsed icon on hover', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    await user.hover(within(rail()).getByRole('link', { name: 'Dashboards' }))

    await waitFor(() => {
      expect(tooltipTexts()).toContain('Dashboards')
    })
  })

  it('names a collapsed icon on keyboard focus too', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    within(rail()).getByRole('link', { name: 'Profile' }).focus()

    await waitFor(() => {
      expect(tooltipTexts()).toContain('Profile')
    })
  })

  it('stays quiet while expanded, where the label is already on screen', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.hover(within(rail()).getByRole('link', { name: 'Dashboards' }))
    await user.hover(within(rail()).getByRole('link', { name: 'Profile' }))

    expect(tooltipTexts()).toEqual([])
  })

  it('drops the group headings rather than truncating them', async () => {
    const user = userEvent.setup()
    renderSidebar()

    expect(within(rail()).getByText('LIBRARY')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(within(rail()).queryByText('LIBRARY')).not.toBeInTheDocument()
    expect(within(rail()).queryByText('MONITOR')).not.toBeInTheDocument()
  })

  // Collapsing is chrome, not an account action, so the toggle sits above the
  // divider that opens the account block rather than trailing Sign Out.
  it('puts the toggle ahead of the account actions', () => {
    renderSidebar()

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
    const profile = within(rail()).getByRole('link', { name: 'Profile' })

    expect(toggle.compareDocumentPosition(profile)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('remembers the choice across a remount', async () => {
    const user = userEvent.setup()
    const first = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    first.unmount()

    renderSidebar()
    expect(rail().className).toContain('md:w-14')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })
})
