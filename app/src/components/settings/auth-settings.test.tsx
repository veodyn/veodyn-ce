import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { AuthSettings } from './auth-settings'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

afterEach(() => resetStores())

describe('AuthSettings', () => {
  it('renders the toggles that map to real organization settings', async () => {
    server.use(
      http.get('/api/node/settings/organization', () =>
        HttpResponse.json({
          settings: { auth_password_login_enabled: true, auth_saml_enabled: false },
        })
      )
    )
    renderWithProviders(<AuthSettings />)

    expect(screen.getByText('Authentication')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Allow password login' })).toBeChecked()
    )
    expect(screen.getByRole('checkbox', { name: 'Allow SAML login' })).not.toBeChecked()
  })

  it('names the providers it cannot configure instead of offering dead controls', () => {
    renderWithProviders(<AuthSettings />)

    expect(
      screen.getByText(/LDAP, Google OAuth and JWT are configured on the server/i)
    ).toBeInTheDocument()
    // The old auth-method dropdown wrote nothing; it is gone.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('persists the toggles and confirms the save', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | null = null
    server.use(
      http.get('/api/node/settings/organization', () =>
        HttpResponse.json({
          settings: { auth_password_login_enabled: true, auth_saml_enabled: false },
        })
      ),
      http.post('/api/node/settings/organization', async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ settings: posted })
      })
    )
    renderWithProviders(
      <>
        <AuthSettings />
        <Toaster />
      </>
    )

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Allow SAML login' })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('checkbox', { name: 'Allow SAML login' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ auth_saml_enabled: true, auth_password_login_enabled: true })
    // Toaster is not mounted by renderWithProviders, so this test mounts it
    // itself alongside the component to assert on what actually reaches the
    // screen, not a spy call. Scoped to sonner's own data-type="success"
    // attribute rather than a bare text query: the text reaching the DOM
    // proves the message was shown, not that it arrived as a confirmation
    // rather than a refusal.
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toHaveTextContent(
        /Authentication settings saved/i
      )
    )
  })
})
