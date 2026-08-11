import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { GroupList } from './group-list'
import {
  groupRow,
  serveGroupList,
  signInAsAdmin,
  toastOfType,
  type Write,
} from './users-admin-fixtures'

const confirmSpy = vi.spyOn(window, 'confirm')

afterEach(() => {
  resetStores()
  confirmSpy.mockReset()
})

const DATA_TEAM = groupRow({ id: 3, name: 'Data Team', type: 'regular' })
const READONLY = groupRow({ id: 4, name: 'Readonly', type: 'regular' })

function renderList(onSelectGroup = vi.fn()) {
  renderWithProviders(
    <>
      <GroupList onSelectGroup={onSelectGroup} />
      <Toaster />
    </>
  )
  return onSelectGroup
}

const deletes = (writes: Write[]) => writes.filter((w) => w.method === 'DELETE')

describe('GroupList delete', () => {
  it('asks before deleting and sends nothing when the answer is no', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroupList([DATA_TEAM, READONLY])
    renderList()

    // Not left at jsdom's default: confirm() answers undefined there, which the
    // component would also read as "cancelled", so a build that had dropped the
    // guard entirely would still satisfy the assertions below.
    confirmSpy.mockReturnValue(false)
    await user.click(await screen.findByRole('button', { name: 'Delete Data Team' }))

    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(confirmSpy.mock.calls[0][0]).toMatch(/data team/i)
    expect(deletes(writes)).toEqual([])
    expect(screen.getByText('Data Team')).toBeInTheDocument()
  })

  it('deletes the chosen group and refetches the list', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroupList([DATA_TEAM, READONLY])
    renderList()

    confirmSpy.mockReturnValue(true)
    await user.click(await screen.findByRole('button', { name: 'Delete Data Team' }))

    await waitFor(() =>
      expect(deletes(writes)).toEqual([
        { method: 'DELETE', path: `/api/node/groups/${DATA_TEAM.id}`, body: null },
      ])
    )
    await waitFor(() => expect(screen.queryByText('Data Team')).not.toBeInTheDocument())
    // The other group is what makes this a delete rather than a list that
    // emptied itself: the absence above passes either way.
    expect(screen.getByText('Readonly')).toBeInTheDocument()
    await waitFor(() => expect(toastOfType('success')).toHaveTextContent(/"Data Team" deleted/i))
  })

  it('leaves the row in place when the delete is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroupList([DATA_TEAM], { failDelete: true })
    renderList()

    confirmSpy.mockReturnValue(true)
    await user.click(await screen.findByRole('button', { name: 'Delete Data Team' }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to delete group/i))
    expect(screen.getByText('Data Team')).toBeInTheDocument()
  })
})

describe('GroupList create', () => {
  it('creates the group, lists it, and opens it', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroupList([DATA_TEAM])
    const onSelectGroup = renderList()

    await user.click(await screen.findByRole('button', { name: /new group/i }))
    const field = await screen.findByLabelText('Group Name')
    // Nothing typed yet, so there is nothing to create. Checked after the
    // dialog is open, so this is a disabled control rather than a missing one.
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    await user.type(field, 'Platform Team')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'POST',
        path: '/api/node/groups',
        body: { name: 'Platform Team' },
      })
    )
    // Reported to the caller so the page can open the new group, and refetched
    // so the list behind it is not one group out of date.
    await waitFor(() =>
      expect(onSelectGroup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Platform Team' }))
    )
    expect(await screen.findByText('Platform Team')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the dialog open and reports the failure when the create is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroupList([DATA_TEAM], { failCreate: true })
    const onSelectGroup = renderList()

    await user.click(await screen.findByRole('button', { name: /new group/i }))
    await user.type(await screen.findByLabelText('Group Name'), 'Platform Team')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to create group/i))
    // Closing the dialog on a refusal would look like it worked, and the typed
    // name would be gone with it.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Group Name')).toHaveValue('Platform Team')
    expect(onSelectGroup).not.toHaveBeenCalled()
  })
})
