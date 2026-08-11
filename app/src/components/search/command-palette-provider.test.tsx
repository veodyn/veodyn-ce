import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPaletteProvider } from '@/components/search/command-palette-provider'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import { useAuthStore, type CurrentUser, type Permission } from '@/stores/auth-store'
import { SEARCH_PLACEHOLDER } from '@/components/home/omnisearch-input'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}))

const permissions: Permission[] = ['view_query']
const mockUser: CurrentUser = {
  id: 1, name: 'Test User', email: 'test@example.com', profile_image_url: '',
  groups: [2], api_key: 'k', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', is_disabled: false,
  is_invitation_pending: false, active_at: '2026-01-01T00:00:00Z',
  is_email_verified: true, auth_type: 'password', permissions, isAdmin: false,
  hasPermission: (p) => permissions.includes(p), canEdit: () => false, canCreate: () => true,
}

function renderProvider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ConfigProvider value={toClientConfig(NEUTRAL_CONFIG)}>
        <CommandPaletteProvider />
      </ConfigProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
})

describe('CommandPaletteProvider', () => {
  it('is closed initially', () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderProvider()

    expect(
      screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)
    ).not.toBeInTheDocument()
  })

  it('opens the palette on Cmd/Ctrl+K', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderProvider()
    const user = userEvent.setup()

    expect(
      screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)
    ).not.toBeInTheDocument()

    await user.keyboard('{Meta>}k{/Meta}')

    expect(
      await screen.findByPlaceholderText(SEARCH_PLACEHOLDER)
    ).toBeInTheDocument()
  })

  it('closes the palette when the shortcut is pressed again', async () => {
    useAuthStore.setState({ currentUser: mockUser, isAuthenticated: true, isLoading: false })
    renderProvider()
    const user = userEvent.setup()

    await user.keyboard('{Meta>}k{/Meta}')
    expect(
      await screen.findByPlaceholderText(SEARCH_PLACEHOLDER)
    ).toBeInTheDocument()

    await user.keyboard('{Meta>}k{/Meta}')

    expect(
      screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)
    ).not.toBeInTheDocument()
  })
})
