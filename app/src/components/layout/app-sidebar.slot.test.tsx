import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import { useAuthStore, type CurrentUser, type Permission } from '@/stores/auth-store'
import type { FeatureDescriptor } from '@/features/types'

function NavRowBadgeStub() {
  return <span>3 waiting</span>
}

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/queries'),
}))

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    messages: {
      id: 'messages',
      nav: [],
      routes: [],
      slots: { 'nav.rowBadge:/queries': async () => ({ default: NavRowBadgeStub }) },
    },
  }
  return { FEATURES }
})

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

describe('the nav row badge slot', () => {
  it('renders the contributed badge beside the row it names', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderSidebar()

    expect(await screen.findByText('3 waiting')).toBeInTheDocument()
  })

  it('never renders on a row nothing contributed to', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    vi.mocked(usePathname).mockReturnValue('/dashboards')
    renderSidebar()

    expect(await screen.findByText('3 waiting')).toBeInTheDocument()
    const dashboardsLink = screen.getByRole('link', { name: 'Dashboards' })
    expect(dashboardsLink).not.toHaveTextContent('waiting')
  })
})
