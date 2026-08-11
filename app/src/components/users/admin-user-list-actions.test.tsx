import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { AdminUserList } from './admin-user-list'
import { serveUserList, userRow } from './admin-user-fixtures'
import { signInAsAdmin, toastOfType, type Write } from './users-admin-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const confirmSpy = vi.spyOn(window, 'confirm')

afterEach(() => {
  resetStores()
  confirmSpy.mockReset()
})

const ROOT = userRow({ id: 1, name: 'Root Admin', email: 'root@example.com' })
const JANE = userRow({ id: 2, name: 'Jane Analyst', email: 'jane@example.com' })

function renderList() {
  renderWithProviders(
    <>
      <AdminUserList />
      <Toaster />
    </>
  )
}

const deletes = (writes: Write[]) => writes.filter((w) => w.method === 'DELETE')

describe('AdminUserList row actions', () => {
  it('disables the account and drops it out of the active filter', async () => {
    const user = userEvent.setup()
    signInAsAdmin(ROOT.id)
    const { writes } = serveUserList([ROOT, JANE])
    renderList()

    expect(await screen.findByRole('link', { name: 'Jane Analyst' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Disable' }))

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'POST',
        path: `/api/node/users/${JANE.id}/disable`,
        body: null,
      })
    )
    await waitFor(() => expect(toastOfType('success')).toHaveTextContent(/jane analyst.*disabled/i))
    // The list refetches, so the row leaves the Active filter it no longer
    // belongs to. Asserting only the request would not notice a stale table.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Jane Analyst' })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('link', { name: 'Root Admin' })).toBeInTheDocument()
  })

  it('leaves the account listed when the disable is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin(ROOT.id)
    serveUserList([ROOT, JANE], { failDisable: true })
    renderList()

    expect(await screen.findByRole('link', { name: 'Jane Analyst' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Disable' }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to disable user/i))
    // Removing the row on a refused disable would tell the admin the account
    // was locked while it is still signing in.
    expect(screen.getByRole('link', { name: 'Jane Analyst' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument()
  })

  it('asks before deleting a pending invitation and sends nothing when told not to', async () => {
    const user = userEvent.setup()
    signInAsAdmin(ROOT.id)
    const invited = userRow({ id: 5, name: 'Pending User', is_invitation_pending: true })
    const { writes } = serveUserList([invited])
    renderList()

    await user.click(screen.getByRole('tab', { name: 'Pending Invitations' }))
    expect(await screen.findByRole('link', { name: 'Pending User' })).toBeInTheDocument()

    // Stubbed to an explicit false rather than left at jsdom's undefined, which
    // the component would read as "cancelled" even with the guard removed.
    confirmSpy.mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(confirmSpy.mock.calls[0][0]).toMatch(/pending user/i)
    expect(deletes(writes)).toEqual([])
    expect(screen.getByRole('link', { name: 'Pending User' })).toBeInTheDocument()
  })

  it('deletes the pending invitation once the confirmation is accepted', async () => {
    const user = userEvent.setup()
    signInAsAdmin(ROOT.id)
    const invited = userRow({ id: 5, name: 'Pending User', is_invitation_pending: true })
    const { writes } = serveUserList([invited])
    renderList()

    await user.click(screen.getByRole('tab', { name: 'Pending Invitations' }))
    expect(await screen.findByRole('link', { name: 'Pending User' })).toBeInTheDocument()

    confirmSpy.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deletes(writes)).toEqual([
        { method: 'DELETE', path: `/api/node/users/${invited.id}`, body: null },
      ])
    )
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Pending User' })).not.toBeInTheDocument()
    )
  })

  it('re-enables a disabled account from the disabled filter', async () => {
    const user = userEvent.setup()
    signInAsAdmin(ROOT.id)
    const disabledJane = userRow({ ...JANE, is_disabled: true, disabled_at: JANE.updated_at })
    const { writes } = serveUserList([ROOT, disabledJane])
    renderList()

    await user.click(screen.getByRole('tab', { name: 'Disabled Users' }))
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'DELETE',
        path: `/api/node/users/${JANE.id}/disable`,
        body: null,
      })
    )
    // Enabled, so the account leaves the Disabled filter the same way it left
    // Active when it was disabled.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Jane Analyst' })).not.toBeInTheDocument()
    )
    await waitFor(() => expect(toastOfType('success')).toHaveTextContent(/jane analyst.*enabled/i))
  })
})
