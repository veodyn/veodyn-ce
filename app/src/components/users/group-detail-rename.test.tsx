import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { GroupDetail } from './group-detail'
import {
  GROUP_ID,
  member,
  serveGroup,
  signInAsAdmin,
  toastOfType,
  type Write,
} from './users-admin-fixtures'

const confirmSpy = vi.spyOn(window, 'confirm')

afterEach(() => {
  resetStores()
  confirmSpy.mockReset()
})

const JANE = member()

function renderDetail(onBack = vi.fn()) {
  renderWithProviders(
    <>
      <GroupDetail groupId={String(GROUP_ID)} onBack={onBack} />
      <Toaster />
    </>
  )
  return onBack
}

const saveButton = () => screen.queryByRole('button', { name: 'Save' })
const deletes = (writes: Write[]) => writes.filter((w) => w.method === 'DELETE')

describe('GroupDetail rename', () => {
  it('offers Save only once the name has actually changed, and posts the new name', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE] })
    renderDetail()

    const field = await screen.findByDisplayValue('Data Team')
    // Nothing has been edited yet, so there is nothing to save. Asserted after
    // the field is on screen, so this is "no pending change" and not "the page
    // never rendered".
    expect(saveButton()).not.toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'Platform Team')

    const save = await screen.findByRole('button', { name: 'Save' })
    await user.click(save)

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'POST',
        path: `/api/node/groups/${GROUP_ID}`,
        body: { name: 'Platform Team' },
      })
    )
    await waitFor(() => expect(toastOfType('success')).toHaveTextContent(/group name updated/i))
    // The saved name is now the group's name, so the unsaved-change affordance
    // has nothing left to report and goes with it.
    await waitFor(() => expect(saveButton()).not.toBeInTheDocument())
  })

  it('does not offer Save for a name that is empty or only whitespace', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE] })
    renderDetail()

    const field = await screen.findByDisplayValue('Data Team')
    // Positive control first: a real name does offer Save, so every absence
    // below is about the value typed and not about a control that never
    // renders here at all.
    await user.clear(field)
    await user.type(field, 'Platform Team')
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()

    // An empty field and a field holding spaces are both names the save would
    // refuse, so neither may be offered as a saveable change.
    await user.clear(field)
    await waitFor(() => expect(saveButton()).not.toBeInTheDocument())
    await user.type(field, '   ')
    expect(saveButton()).not.toBeInTheDocument()

    // Padding around the saved name is not a change either: saving it would
    // post the name the group already has.
    await user.clear(field)
    await user.type(field, '  Data Team  ')
    expect(saveButton()).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('posts the trimmed name and then has nothing left to save', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE] })
    renderDetail()

    const field = await screen.findByDisplayValue('Data Team')
    await user.clear(field)
    await user.type(field, '  Platform Team  ')
    await user.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'POST',
        path: `/api/node/groups/${GROUP_ID}`,
        body: { name: 'Platform Team' },
      })
    )
    // The group now carries the trimmed name, so the padded text still in the
    // field is no longer a pending change.
    await waitFor(() => expect(saveButton()).not.toBeInTheDocument())
  })

  it('keeps the edit and the Save button in place when the rename is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroup({ members: [JANE], failRename: true })
    renderDetail()

    const field = await screen.findByDisplayValue('Data Team')
    await user.clear(field)
    await user.type(field, 'Platform Team')
    await user.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to update group/i))
    // The rename did not happen, so the admin must still be able to retry it
    // without retyping: the typed name stays and Save stays with it.
    expect(field).toHaveValue('Platform Team')
    expect(saveButton()).toBeInTheDocument()
  })
})

describe('GroupDetail delete', () => {
  it('sends nothing and stays on the page when the confirmation is declined', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE] })
    const onBack = renderDetail()

    // Not stubbed to a bare false: jsdom's own confirm() answers undefined,
    // which the component would also read as "cancelled", so a build that
    // dropped the guard entirely would still pass the assertions below.
    confirmSpy.mockReturnValue(false)

    await user.click(await screen.findByRole('button', { name: /delete group/i }))

    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(confirmSpy.mock.calls[0][0]).toMatch(/data team/i)
    expect(deletes(writes)).toEqual([])
    expect(onBack).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Members (1)' })).toBeInTheDocument()
  })

  it('deletes the group and returns to the list once the confirmation is accepted', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE] })
    const onBack = renderDetail()

    confirmSpy.mockReturnValue(true)
    await user.click(await screen.findByRole('button', { name: /delete group/i }))

    await waitFor(() =>
      expect(deletes(writes)).toEqual([
        { method: 'DELETE', path: `/api/node/groups/${GROUP_ID}`, body: null },
      ])
    )
    await waitFor(() => expect(toastOfType('success')).toHaveTextContent(/"Data Team" deleted/i))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('names the saved group in the confirmation, not an unsaved edit in the field', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE] })
    const onBack = renderDetail()

    const field = await screen.findByDisplayValue('Data Team')
    await user.clear(field)
    await user.type(field, 'Platform Team')
    // Typed and deliberately not saved, so the field now disagrees with the
    // server. Nothing has been posted, which is what makes "Platform Team" a
    // group that does not exist.
    expect(writes).toEqual([])

    confirmSpy.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /delete group/i }))

    // The last thing said before an irreversible delete has to describe what
    // is actually being deleted.
    expect(confirmSpy.mock.calls[0][0]).toBe('Delete group "Data Team"? This cannot be undone.')
    await waitFor(() => expect(toastOfType('success')).toHaveTextContent(/"Data Team" deleted/i))
    expect(toastOfType('success')).not.toHaveTextContent(/platform team/i)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('stays on the group when the delete is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroup({ members: [JANE], failDelete: true })
    const onBack = renderDetail()

    confirmSpy.mockReturnValue(true)
    await user.click(await screen.findByRole('button', { name: /delete group/i }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to delete group/i))
    // Navigating away on a failed delete would show the list still containing
    // the group and read as a stale cache rather than as a refusal.
    expect(onBack).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Members (1)' })).toBeInTheDocument()
  })
})
