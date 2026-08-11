import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { GroupDetail } from './group-detail'
import {
  GROUP_ID,
  dataSource,
  member,
  serveGroup,
  signInAsAdmin,
  signInAsMember,
  toastOfType,
} from './users-admin-fixtures'

afterEach(() => resetStores())

const JANE = member({ id: 2, name: 'Jane Analyst', email: 'jane@example.com' })
const ROOT = member({ id: 1, name: 'Root Admin', email: 'root@example.com' })

function renderDetail(onBack = vi.fn()) {
  renderWithProviders(
    <>
      <GroupDetail groupId={String(GROUP_ID)} onBack={onBack} />
      <Toaster />
    </>
  )
  return onBack
}

// Group membership is a permissions surface, so every negative assertion here
// is paired with a positive one first. A component that threw during render
// would satisfy "the Delete button is absent" perfectly well.
describe('GroupDetail permission surface', () => {
  it('renders the group name and the counts behind each tab', async () => {
    signInAsAdmin()
    serveGroup({ members: [JANE, ROOT], dataSources: [dataSource()] })
    renderDetail()

    // The name is an editable field for an admin on a regular group, so the
    // heading query below would find nothing here on purpose.
    expect(await screen.findByDisplayValue('Data Team')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Members (2)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Data Sources (1)' })).toBeInTheDocument()
    expect(screen.getByText('Jane Analyst')).toBeInTheDocument()
    expect(screen.getByText('Root Admin')).toBeInTheDocument()
  })

  it('shows a normal member the roster and none of the controls that change it', async () => {
    signInAsMember()
    serveGroup({ members: [JANE] })
    renderDetail()

    // Positive first: the page rendered, and rendered this person's row.
    expect(await screen.findByRole('heading', { name: 'Data Team' })).toBeInTheDocument()
    expect(screen.getByText('Jane Analyst')).toBeInTheDocument()

    // None of these belong to a non-admin: the name is not editable, there is
    // no way to add or remove a member, and the group cannot be deleted.
    expect(screen.queryByDisplayValue('Data Team')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search users to add...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete group/i })).not.toBeInTheDocument()
  })

  it('refuses an admin the rename field and the delete button on a built-in group', async () => {
    signInAsAdmin()
    serveGroup({ group: { name: 'admin', type: 'builtin' }, members: [JANE] })
    renderDetail()

    expect(await screen.findByRole('heading', { name: 'admin' })).toBeInTheDocument()
    expect(screen.getByText('built-in')).toBeInTheDocument()

    // The one that keeps this test honest. The member search is admin-gated
    // and NOT builtin-gated, so its presence proves the session really is an
    // admin, which is what makes the two absences below a statement about the
    // group's type rather than about a session that quietly failed to be one.
    expect(screen.getByPlaceholderText('Search users to add...')).toBeInTheDocument()

    expect(screen.queryByDisplayValue('admin')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete group/i })).not.toBeInTheDocument()
  })

  it('lets an admin remove another member of a built-in group but not themself', async () => {
    signInAsAdmin(ROOT.id)
    serveGroup({ group: { name: 'admin', type: 'builtin' }, members: [ROOT, JANE] })
    renderDetail()

    expect(await screen.findByText('Root Admin')).toBeInTheDocument()
    expect(screen.getByText('Jane Analyst')).toBeInTheDocument()

    // Removing yourself from the built-in admin group is the escalation-in-
    // reverse case: it locks the last admin out of the instance. Exactly one
    // Remove is offered, and it is not on the signed-in admin's own row.
    const removes = screen.getAllByRole('button', { name: 'Remove' })
    expect(removes).toHaveLength(1)
    expect(removes[0].parentElement).toHaveTextContent('Jane Analyst')
    expect(removes[0].parentElement).not.toHaveTextContent('Root Admin')
  })

  it('offers an admin the delete button on a regular group', async () => {
    signInAsAdmin()
    serveGroup({ members: [JANE] })
    renderDetail()

    expect(await screen.findByDisplayValue('Data Team')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete group/i })).toBeInTheDocument()
    // A regular group carries no built-in marker, so the badge that suppresses
    // the control above is genuinely absent rather than merely unread.
    expect(screen.queryByText('built-in')).not.toBeInTheDocument()
  })

  it('surfaces a failed load as an error rather than as a group that is not there', async () => {
    signInAsAdmin()
    serveGroup({ failLoad: true })
    renderDetail()

    // Scoped to sonner's data-type rather than a bare text query: the words
    // reaching the DOM prove a message was shown, not that it arrived as a
    // failure rather than a confirmation.
    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to load group/i))
    // The body copy is the half the toast cannot carry. A toast is gone in a
    // few seconds and this page is what the admin is left looking at, so a
    // refused request must not settle into the wording for a missing group.
    expect(await screen.findByText(/failed to load this group/i)).toBeInTheDocument()
    expect(screen.queryByText('Group not found.')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /members/i })).not.toBeInTheDocument()
  })

  it('reports a group that really is gone as missing, with no failure message', async () => {
    signInAsAdmin()
    serveGroup({ notFound: true })
    renderDetail()

    // 404 is the only answer that means the group is absent rather than
    // unreachable, and it is the one case where "not found" is the truth.
    expect(await screen.findByText('Group not found.')).toBeInTheDocument()
    // Covers the toast as well as the body: neither should claim a failure.
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /members/i })).not.toBeInTheDocument()
  })
})
