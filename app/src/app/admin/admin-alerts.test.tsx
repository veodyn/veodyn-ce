// Two admin pages showed their error text in plain red type but never
// announced it: no role="alert", so a screen-reader user learned nothing had
// gone wrong. Moving both onto the Alert primitive fixes that, since Alert
// sets role="alert" itself.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import AdminJobsPage from './jobs/page'
import AdminOutdatedPage from './outdated/page'

// Both pages gate their real-backend query on this module constant. Forcing
// it here is the same pattern the other real-mode suites in this repo use,
// since USE_REAL_API is read at import time and cannot be flipped at runtime.
vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

function signInAsAdmin() {
  const permissions = ['admin' as const]
  const admin: CurrentUser = {
    id: 1,
    name: 'Root',
    email: 'root@example.com',
    profile_image_url: '',
    groups: [1],
    api_key: 'root-key',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-01-01T00:00:00Z',
    is_email_verified: true,
    auth_type: 'password',
    permissions,
    isAdmin: true,
    hasPermission: (permission) => permissions.includes(permission as 'admin'),
    canEdit: () => true,
    canCreate: () => true,
  }
  useAuthStore.setState({ currentUser: admin })
}

afterEach(() => resetStores())

describe('admin page errors announce themselves', () => {
  it('announces the jobs page error assertively', async () => {
    signInAsAdmin()
    server.use(
      http.get('/api/admin/queries/rq-status', () =>
        HttpResponse.json({ message: 'Workers unavailable' }, { status: 503 })
      )
    )
    renderWithProviders(<AdminJobsPage />)

    // Wait for the error text to actually be on screen (this resolves as soon
    // as the failing fetch settles), then assert the accessible role
    // synchronously. That way a missing role="alert" fails immediately on the
    // assertion rather than waiting out findByRole's own polling timeout.
    await screen.findByText(/unavailable/i)
    expect(screen.queryByRole('alert')).toHaveTextContent(/unavailable/i)
  })

  it('announces the outdated-queries page error assertively', async () => {
    signInAsAdmin()
    server.use(
      http.get('/api/admin/queries/outdated', () =>
        HttpResponse.json({ message: 'Outdated queries unavailable' }, { status: 503 })
      )
    )
    renderWithProviders(<AdminOutdatedPage />)

    await screen.findByText(/unavailable/i)
    expect(screen.queryByRole('alert')).toHaveTextContent(/unavailable/i)
  })
})
