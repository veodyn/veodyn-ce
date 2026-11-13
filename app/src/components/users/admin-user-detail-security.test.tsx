import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { AdminUserDetailSecurity } from './admin-user-detail-security'
import type { RedashUserDetail } from './user-detail-types'

afterEach(() => {
  resetStores()
})

const USER = { id: 7, name: 'Jane', api_key: 'k', is_invitation_pending: false } as RedashUserDetail
const LINK = 'https://example.test/reset/abc'

function renderSecurity() {
  renderWithProviders(
    <>
      <AdminUserDetailSecurity
        userId="7"
        user={USER}
        isOwnProfile={false}
        isAdmin
        canEdit
        inviteLink={LINK}
        onInviteLinkChange={() => {}}
        onUserChange={() => {}}
      />
      <Toaster />
    </>
  )
}

const toastOf = (type: string) => document.querySelector(`[data-sonner-toast][data-type="${type}"]`)

describe('AdminUserDetailSecurity invite link copy', () => {
  it('confirms a copied link with a success toast', async () => {
    const user = userEvent.setup()
    renderSecurity()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(await navigator.clipboard.readText()).toBe(LINK)
    await waitFor(() => expect(toastOf('success')).toHaveTextContent(/link copied/i))
  })

  it('raises an error toast when the clipboard rejects the write', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    renderSecurity()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    await waitFor(() => expect(toastOf('error')).toHaveTextContent(/could not copy/i))
    expect(toastOf('success')).toBeNull()
  })
})
