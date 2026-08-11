import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePathname } from 'next/navigation'
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

function renderSidebar(config = toClientConfig(NEUTRAL_CONFIG)) {
  return render(
    <ConfigProvider value={config}>
      <AppSidebar />
    </ConfigProvider>
  )
}

afterEach(() => {
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
  vi.mocked(usePathname).mockReturnValue('/queries')
})

describe('AppSidebar', () => {
  it('renders the brand name as text when no logo is configured', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    const value = toClientConfig({
      ...NEUTRAL_CONFIG,
      brand: { ...NEUTRAL_CONFIG.brand, name: 'RegionHub', logo: null },
    })
    renderSidebar(value)
    expect(screen.getAllByText('RegionHub').length).toBeGreaterThan(0)
  })

  it('renders the fixed IA sections for a signed-in user', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderSidebar()
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0)
    expect(screen.getAllByText('LIBRARY').length).toBeGreaterThan(0)
  })

  it('hides the ADMIN section for a non-admin user', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderSidebar()
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument()
  })

  it('renders nothing when there is no current user', () => {
    const { container } = renderSidebar()
    expect(container).toBeEmptyDOMElement()
  })

  it('marks the nav link matching the current pathname as active', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderSidebar()
    // The mocked pathname is /queries, which is the Queries link's href.
    expect(screen.getByRole('link', { name: 'Queries' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboards' })).not.toHaveAttribute('aria-current')
  })

  it('opens the mobile navigation sheet when the menu trigger is clicked', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderSidebar()
    const user = userEvent.setup()

    // The Sheet content (including its sr-only title) is not in the DOM
    // until the drawer is opened.
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))

    expect(await screen.findByText('Navigation')).toBeInTheDocument()
  })

  it('closes the mobile navigation sheet when a nav link inside it is clicked', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderSidebar()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(await screen.findByText('Navigation')).toBeInTheDocument()

    // The desktop aside and the mobile sheet both render a "Home" link once
    // the sheet is open; the sheet's Popup is portalled to the end of the
    // document, so it is the last match.
    const homeLinks = screen.getAllByRole('link', { name: 'Home' })
    await user.click(homeLinks[homeLinks.length - 1])

    expect(screen.queryByText('Navigation')).not.toBeInTheDocument()
  })

  it('marks only the exact-match link as aria-current, not a parent domain link', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    vi.mocked(usePathname).mockReturnValue('/data/transit')
    const config = toClientConfig({
      ...NEUTRAL_CONFIG,
      domains: [{ key: 'transit', label: 'Transit' }],
    })
    renderSidebar(config)

    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('href', '/data/transit')
  })

  it('calls logout when Sign Out is clicked', async () => {
    const logout = vi.fn()
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false, logout })
    renderSidebar()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('renders a Documentation footer row only when brand.docs_url is configured', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    const { unmount } = renderSidebar()
    // The neutral config has no docs_url, so the row must be absent, not disabled.
    expect(screen.queryByRole('link', { name: /documentation/i })).not.toBeInTheDocument()
    unmount()

    const value = toClientConfig({
      ...NEUTRAL_CONFIG,
      brand: { ...NEUTRAL_CONFIG.brand, docs_url: 'https://docs.example.com' },
    })
    renderSidebar(value)
    const docs = screen.getByRole('link', { name: /documentation/i })
    expect(docs).toHaveAttribute('href', 'https://docs.example.com')
    expect(docs).toHaveAttribute('target', '_blank')
  })

  it('links to the profile from the footer', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderSidebar()
    const profile = screen.getByRole('link', { name: /profile/i })
    expect(profile).toHaveAttribute('href', '/profile')
  })

  // jsdom does no layout, so these assert the classes that produce the layout
  // rather than measured geometry. Without them the rail stretches to the full
  // document height on a long page, which pushes Sign Out below the fold and
  // leaves the nav unable to scroll to its last item.
  it('bounds the desktop rail to the viewport so its footer stays reachable', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    const { container } = renderSidebar()

    const rail = container.querySelector('aside')
    expect(rail).toHaveClass('md:h-screen')
    expect(rail).toHaveClass('md:sticky')
    expect(rail).toHaveClass('md:top-0')
  })

  it('lets the nav scroller shrink below its content height', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    const { container } = renderSidebar()

    // min-height:auto is the flex default; without min-h-0 flex-1 resolves to
    // the nav's full content height and the scroller never scrolls.
    const scroller = container.querySelector('aside [data-slot="scroll-area"]')
    expect(scroller).toHaveClass('min-h-0')
    expect(scroller).toHaveClass('flex-1')
  })
})
