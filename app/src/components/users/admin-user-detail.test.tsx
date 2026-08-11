import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import { Toaster } from '@/components/ui/sonner'
import { AdminUserDetail } from './admin-user-detail'
import type { RedashUserDetail } from './user-detail-types'

const USER_ID = 7

afterEach(() => {
  resetStores()
})

function detail(): RedashUserDetail {
  return {
    id: USER_ID,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    profile_image_url: null,
    groups: [2],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    disabled_at: null,
    is_disabled: false,
    active_at: null,
    is_invitation_pending: false,
    is_email_verified: true,
    auth_type: 'password',
    api_key: 'key-for-seven',
  }
}

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

/**
 * Serves the detail route with a POST that stays in flight until the returned
 * `release` is called, and records every save body so a double submit is
 * visible rather than inferred.
 */
function serveUser() {
  let stored = detail()
  const saves: Record<string, unknown>[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  server.use(
    http.get(`/api/node/users/${USER_ID}`, () => HttpResponse.json(stored)),
    http.get('/api/node/groups', () =>
      HttpResponse.json([{ id: 2, name: 'default', type: 'builtin' }])
    ),
    http.post(`/api/node/users/${USER_ID}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      saves.push(body)
      await gate
      stored = { ...stored, name: String(body.name), email: String(body.email) }
      return HttpResponse.json(stored)
    })
  )

  return { saves, release: () => release() }
}

describe('AdminUserDetail', () => {
  it('associates the account labels with the fields they name', async () => {
    signInAsAdmin()
    serveUser()
    renderWithProviders(<AdminUserDetail userId={String(USER_ID)} />)

    // Queried by label rather than by role: a <label> that names nothing looks
    // identical on screen and is unreachable here.
    expect(await screen.findByLabelText('Name')).toHaveValue('Ada Lovelace')
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
  })

  it('disables Save while the update is in flight so the bar cannot double submit', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { saves, release } = serveUser()
    renderWithProviders(
      <>
        <AdminUserDetail userId={String(USER_ID)} />
        <Toaster />
      </>
    )

    const nameField = await screen.findByLabelText('Name')
    await user.clear(nameField)
    await user.type(nameField, 'Ada King')

    const save = await screen.findByRole('button', { name: /save changes/i })
    await user.click(save)

    // Held by the gate: the request is still open at this point, so a second
    // press must not reach the backend.
    await waitFor(() => expect(saves).toHaveLength(1))
    await user.click(save)
    expect(saves).toHaveLength(1)
    expect(save).toBeDisabled()

    release()
    // Scoped to sonner's own data-type="success" attribute rather than a bare
    // text query: the text reaching the DOM proves the message was shown, not
    // that it arrived as a confirmation rather than a refusal.
    await waitFor(() =>
      expect(document.querySelector('[data-sonner-toast][data-type="success"]')).toHaveTextContent(
        /user updated/i
      )
    )
    // Saved values are reloaded, so the unsaved-changes bar has nothing left to
    // report and the button goes with it.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
    )
    expect(saves[0]).toMatchObject({ name: 'Ada King', email: 'ada@example.com' })
  })
})
