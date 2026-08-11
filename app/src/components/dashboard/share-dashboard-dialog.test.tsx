import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockDashboards } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ShareDashboardDialog } from './share-dashboard-dialog'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

function signIn(permissions: string[]) {
  useAuthStore.setState({
    currentUser: buildCurrentUser({ id: 4, name: 'Owner', email: 'o@example.com', permissions }),
  })
}

beforeEach(() => signIn(['publish_dashboard', 'edit_dashboard']))
afterEach(() => resetStores())

describe('ShareDashboardDialog', () => {
  it('renders public-access controls and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <ShareDashboardDialog open onClose={onClose} dashboard={mockDashboards[0]} />
    )

    expect(screen.getByText(/share dashboard/i)).toBeInTheDocument()
    expect(screen.getByText(/public access/i)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('posts the dashboard share mutation', async () => {
    const user = userEvent.setup()
    let hit = false
    server.use(
      http.post('/api/node/dashboards/1/share', () => {
        hit = true
        return HttpResponse.json({ public_url: 'http://localhost/shared/abc', api_key: 'abc' })
      })
    )

    renderWithProviders(
      <ShareDashboardDialog open onClose={() => {}} dashboard={mockDashboards[0]} />
    )

    // By name rather than by position in the button list: the control is a
    // switch now, and an index into every button in the dialog was only ever
    // right by accident.
    await user.click(screen.getByRole('switch', { name: 'Toggle public access' }))
    await waitFor(() => expect(hit).toBe(true))
  })

  it('shares with no expiry by default, sending the body it always sent', async () => {
    const user = userEvent.setup()
    let body: unknown = 'never called'
    server.use(
      http.post('/api/node/dashboards/1/share', async ({ request }) => {
        body = await request.text()
        return HttpResponse.json({ public_url: 'http://localhost/shared/abc', api_key: 'abc' })
      })
    )

    renderWithProviders(
      <ShareDashboardDialog open onClose={() => {}} dashboard={mockDashboards[0]} />
    )
    await user.click(screen.getByRole('switch', { name: 'Toggle public access' }))

    await waitFor(() => expect(body).not.toBe('never called'))
    expect(body).toBe('')
  })

  it('sends the expiry when one is chosen', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post('/api/node/dashboards/1/share', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ public_url: 'http://localhost/shared/abc', api_key: 'abc' })
      })
    )

    renderWithProviders(
      <ShareDashboardDialog open onClose={() => {}} dashboard={mockDashboards[0]} />
    )
    fireEvent.change(screen.getByLabelText(/link expires/i), {
      target: { value: '2026-09-01T10:30' },
    })
    await user.click(screen.getByRole('switch', { name: 'Toggle public access' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ expires_at: new Date('2026-09-01T10:30').toISOString() })
  })

  // Stage handed out `http://flow-dev-redash/public/dashboards/<token>` under
  // the heading "Anyone with the link can view this dashboard". That host is an
  // in-cluster service name: it resolves for nobody the link was sent to, and
  // the copy button copied it faithfully. The dialog renders the address this
  // product actually serves, so a misconfigured Redash host cannot reach the
  // reader.
  it('hands over a link on this origin, not the one Redash reports', () => {
    renderWithProviders(
      <ShareDashboardDialog
        open
        onClose={() => {}}
        dashboard={{
          ...mockDashboards[0],
          public_url: 'http://flow-dev-redash/public/dashboards/tok123',
          api_key: 'tok123',
        }}
      />
    )

    const field = screen.getByLabelText('Public URL')
    expect(field).toHaveValue(`${window.location.origin}/dashboards/public/tok123`)
  })

  it('reads the token off public_url when api_key did not come back', () => {
    renderWithProviders(
      <ShareDashboardDialog
        open
        onClose={() => {}}
        dashboard={{
          ...mockDashboards[0],
          public_url: 'http://flow-dev-redash/public/dashboards/tok456',
          api_key: null,
        }}
      />
    )

    expect(screen.getByLabelText('Public URL')).toHaveValue(
      `${window.location.origin}/dashboards/public/tok456`
    )
  })

  it('refuses to share for a user without publish_dashboard, and says why', () => {
    signIn(['edit_dashboard'])

    renderWithProviders(
      <ShareDashboardDialog open onClose={() => {}} dashboard={mockDashboards[0]} />
    )

    // The Base UI switch renders a span, so it reports disabled through ARIA
    // rather than through the DOM property toBeDisabled reads.
    expect(screen.getByRole('switch', { name: 'Toggle public access' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByText(/do not have permission to share this dashboard/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/link expires/i)).not.toBeInTheDocument()
  })

  it('lets an admin share without publish_dashboard on the group', () => {
    signIn(['admin'])

    renderWithProviders(
      <ShareDashboardDialog open onClose={() => {}} dashboard={mockDashboards[0]} />
    )

    expect(screen.getByRole('switch', { name: 'Toggle public access' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByLabelText(/link expires/i)).toBeInTheDocument()
  })
})
