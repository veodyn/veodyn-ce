import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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
  it('asks in a dialog before deleting and sends nothing when cancelled', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroupList([DATA_TEAM, READONLY])
    renderList()

    await user.click(await screen.findByRole('button', { name: 'Delete Data Team' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/data team/i)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deletes(writes)).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deletes(writes)).toEqual([])
    expect(screen.getByText('Data Team')).toBeInTheDocument()
  })

  it('deletes the chosen group once the dialog is confirmed and refetches the list', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroupList([DATA_TEAM, READONLY])
    renderList()

    await user.click(await screen.findByRole('button', { name: 'Delete Data Team' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deletes(writes)).toEqual([
        { method: 'DELETE', path: `/api/node/groups/${DATA_TEAM.id}`, body: null },
      ])
    )
    await waitFor(() => expect(screen.queryByText('Data Team')).not.toBeInTheDocument())
    expect(screen.getByText('Readonly')).toBeInTheDocument()
    await waitFor(() => expect(toastOfType('success')).toHaveTextContent(/"Data Team" deleted/i))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('leaves the row in place when the delete is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroupList([DATA_TEAM], { failDelete: true })
    renderList()

    await user.click(await screen.findByRole('button', { name: 'Delete Data Team' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

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
    const field = await screen.findByRole('textbox', { name: 'Group Name' })
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()

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

  it('marks the group name field required', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroupList([DATA_TEAM])
    renderList()

    await user.click(await screen.findByRole('button', { name: /new group/i }))

    expect(screen.getByText('Group Name').querySelector('[data-slot="required-marker"]')).not.toBeNull()
    expect(await screen.findByRole('textbox', { name: 'Group Name' })).toBeRequired()
  })

  it('keeps the dialog open and reports the failure when the create is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroupList([DATA_TEAM], { failCreate: true })
    const onSelectGroup = renderList()

    await user.click(await screen.findByRole('button', { name: /new group/i }))
    await user.type(await screen.findByRole('textbox', { name: 'Group Name' }), 'Platform Team')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to create group/i))
    // Closing the dialog on a refusal would look like it worked, and the typed
    // name would be gone with it.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Group Name' })).toHaveValue('Platform Team')
    expect(onSelectGroup).not.toHaveBeenCalled()
  })

  it('flags an empty name on the field, links the message and focuses it', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroupList([DATA_TEAM])
    renderList()

    await user.click(await screen.findByRole('button', { name: /new group/i }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const field = screen.getByRole('textbox', { name: 'Group Name' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Give the group a name.')
    expect(field).toHaveFocus()
    expect(writes).toEqual([])

    await user.type(field, 'P')

    expect(field).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Give the group a name.')).toBeNull()
  })

  it('submits when Enter is pressed in the name field', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroupList([DATA_TEAM])
    renderList()

    await user.click(await screen.findByRole('button', { name: /new group/i }))
    await user.type(await screen.findByRole('textbox', { name: 'Group Name' }), 'Platform Team{Enter}')

    await waitFor(() =>
      expect(writes).toContainEqual({ method: 'POST', path: '/api/node/groups', body: { name: 'Platform Team' } })
    )
  })
})
