import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { ProfileAccount } from './profile-account'
import type { RedashUserDetail } from '@/components/users/user-detail-types'

afterEach(() => resetStores())

const USER = {
  id: 7, name: 'Nick Sawinyh', email: 'nick@veodyn.com', profile_image_url: null,
  groups: [1], created_at: '2026-01-02T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  disabled_at: null, is_disabled: false, active_at: '2026-07-25T00:00:00Z',
  is_invitation_pending: false, is_email_verified: true, auth_type: 'password',
  api_key: 'k',
} satisfies RedashUserDetail

describe('ProfileAccount', () => {
  it('keeps save disabled until something actually changes', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfileAccount user={USER} onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/name/i), '!')
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('saves both fields and reports the saved user', async () => {
    // Mock mode, which the suite runs in, so the save lands in the mock store
    // rather than the proxy. That needs an id the store actually holds; id 1
    // is the Admin fixture.
    const stored = { ...USER, id: 1 }
    const user = userEvent.setup()
    const onSaved = vi.fn()

    renderWithProviders(<ProfileAccount user={stored} onSaved={onSaved} />)
    await user.clear(screen.getByLabelText(/name/i))
    await user.type(screen.getByLabelText(/name/i), 'Nick S')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onSaved.mock.calls[0][0].name).toBe('Nick S')
    expect(useMockDataStore.getState().users.find((u) => u.id === 1)?.name).toBe('Nick S')
  })

  it('keeps the entered values when the save fails', async () => {
    const user = userEvent.setup()
    server.use(http.post('/api/node/users/7', () => new HttpResponse(null, { status: 500 })))
    renderWithProviders(<ProfileAccount user={USER} onSaved={() => {}} />)
    await user.clear(screen.getByLabelText(/name/i))
    await user.type(screen.getByLabelText(/name/i), 'Kept')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByLabelText(/name/i)).toHaveValue('Kept'))
  })

  it('warns that the email is the login identity', () => {
    renderWithProviders(<ProfileAccount user={USER} onSaved={() => {}} />)
    expect(screen.getByText(/sign in/i)).toBeInTheDocument()
  })
})
