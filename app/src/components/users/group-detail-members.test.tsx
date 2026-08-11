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
} from './users-admin-fixtures'

afterEach(() => resetStores())

const JANE = member({ id: 2, name: 'Jane Analyst', email: 'jane@example.com' })
const BOB = member({ id: 3, name: 'Bob Developer', email: 'bob@example.com' })
const ADA = { id: 42, name: 'Ada Lovelace', email: 'ada@example.com' }

function renderDetail() {
  renderWithProviders(
    <>
      <GroupDetail groupId={String(GROUP_ID)} onBack={vi.fn()} />
      <Toaster />
    </>
  )
}

// The child typeahead is covered by group-members.test.tsx. What is covered
// here is the wiring GroupDetail owns: which request each gesture sends, and
// whether the roster on screen still matches the group after it.
describe('GroupDetail membership changes', () => {
  it('removes the member the admin picked, and only that one', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE, BOB] })
    renderDetail()

    expect(await screen.findByText('Jane Analyst')).toBeInTheDocument()
    expect(screen.getByText('Bob Developer')).toBeInTheDocument()

    const janesRemove = screen
      .getAllByRole('button', { name: 'Remove' })
      .find((button) => button.parentElement?.textContent?.includes('Jane Analyst'))
    expect(janesRemove).toBeDefined()
    await user.click(janesRemove as HTMLElement)

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'DELETE',
        path: `/api/node/groups/${GROUP_ID}/members/${JANE.id}`,
        body: null,
      })
    )
    await waitFor(() => expect(screen.queryByText('Jane Analyst')).not.toBeInTheDocument())
    // The other member is what makes this a removal rather than a wipe: an
    // implementation that cleared the list would pass the absence above.
    expect(screen.getByText('Bob Developer')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Members (1)' })).toBeInTheDocument()
  })

  it('keeps the member on screen when the removal is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroup({ members: [JANE], failRemoveMember: true })
    renderDetail()

    expect(await screen.findByText('Jane Analyst')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to remove member/i))
    // Dropping the row optimistically on a refused DELETE would tell the admin
    // the person had lost access while the backend still grants it.
    expect(screen.getByText('Jane Analyst')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Members (1)' })).toBeInTheDocument()
  })

  it('adds the searched user to the group and reloads the roster from the backend', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ members: [JANE], allUsers: [ADA] })
    renderDetail()

    expect(await screen.findByText('Jane Analyst')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Search users to add...'), 'Ada')
    await user.click(await screen.findByRole('option', { name: /ada lovelace/i }))

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'POST',
        path: `/api/node/groups/${GROUP_ID}/members`,
        body: { user_id: ADA.id },
      })
    )
    // The roster is refetched rather than patched locally, so the new row is
    // the backend's answer and the count moves with it.
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: 'Members (2)' })).toBeInTheDocument()
  })

  it('reports a refused add and leaves the roster untouched', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroup({ members: [JANE], allUsers: [ADA], failAddMember: true })
    renderDetail()

    expect(await screen.findByText('Jane Analyst')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Search users to add...'), 'Ada')
    await user.click(await screen.findByRole('option', { name: /ada lovelace/i }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to add member/i))
    // The search result survives the failure so the admin can retry without
    // retyping, which is also why counting occurrences works here: one hit is
    // the still-open result row, and a second would be a member row that the
    // group never gained.
    expect(screen.getByRole('option', { name: /ada lovelace/i })).toBeInTheDocument()
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Members (1)' })).toBeInTheDocument()
  })
})
