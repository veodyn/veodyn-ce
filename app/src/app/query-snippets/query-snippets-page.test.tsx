import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQuerySnippets } from '@/lib/mock-data'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { QuerySnippetsPage } from './query-snippets-page'

// The fixtures split ownership on purpose: "last7d" belongs to user 1 and
// "paginate" to user 2, so one render covers both sides of the permission rule.
const MINE = 'last7d'
const THEIRS = 'paginate'

beforeEach(() => {
  // The mock store is a singleton and these tests both add to it and delete
  // from it, so it goes back or one test decides the next one's fixtures.
  useMockDataStore.setState({ querySnippets: mockQuerySnippets })
})

afterEach(() => resetStores())

function signIn(id: number, isAdmin = false) {
  useAuthStore.setState({
    currentUser: { id, name: 'Tester', isAdmin } as CurrentUser,
  })
}

const stored = (trigger: string) =>
  useMockDataStore.getState().querySnippets.some((s) => s.trigger === trigger)

describe('QuerySnippetsPage', () => {
  it('associates the new snippet fields with their labels', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuerySnippetsPage />)

    await user.click(screen.getByRole('button', { name: /new snippet/i }))

    expect(screen.getByLabelText(/^trigger$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^description$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^snippet$/i)).toBeInTheDocument()
  })

  it('creates a snippet from the labelled fields', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuerySnippetsPage />)

    await user.click(screen.getByRole('button', { name: /new snippet/i }))
    await user.type(screen.getByLabelText(/^trigger$/i), 'last90d')
    await user.type(screen.getByLabelText(/^snippet$/i), "date >= now() - interval '90 days'")
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    expect(await screen.findByText('last90d')).toBeInTheDocument()
  })
})

// QuerySnippetResource.delete (node/redash/handlers/query_snippets.py:33-35)
// calls require_admin_or_owner(snippet.user.id), which aborts 403 for anyone
// who is neither. The row used to show a trash can to all of them, so every
// non-owner was offered a control that could only ever fail.
describe('who is offered the snippet delete', () => {
  it('offers nothing on a snippet written by someone else', async () => {
    signIn(2)
    renderWithProviders(<QuerySnippetsPage />)

    // The row is there, so the missing kebab below is a real absence.
    expect(await screen.findByText(MINE)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Actions for ${MINE}` })
    ).not.toBeInTheDocument()
  })

  it('offers Delete on a snippet this person wrote', async () => {
    signIn(1)
    const user = userEvent.setup()
    renderWithProviders(<QuerySnippetsPage />)

    await user.click(await screen.findByRole('button', { name: `Actions for ${MINE}` }))

    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'data-variant',
      'destructive'
    )
  })

  it('offers Delete to an admin who wrote none of them', async () => {
    signIn(99, true)
    const user = userEvent.setup()
    renderWithProviders(<QuerySnippetsPage />)

    await user.click(await screen.findByRole('button', { name: `Actions for ${THEIRS}` }))

    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('deleting a snippet', () => {
  it('deletes nothing until the confirmation is accepted', async () => {
    signIn(1)
    const user = userEvent.setup()
    renderWithProviders(<QuerySnippetsPage />)

    await user.click(await screen.findByRole('button', { name: `Actions for ${MINE}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    // Permanent, and the dialog is the only thing that says so: Redash deletes
    // the row outright, with no archive and no restore.
    expect(dialog).toHaveTextContent(MINE)
    expect(dialog).toHaveTextContent(/cannot be undone/i)
    expect(stored(MINE)).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(stored(MINE)).toBe(false))
  })

  it('deletes nothing when the confirmation is dismissed', async () => {
    signIn(1)
    const user = userEvent.setup()
    renderWithProviders(<QuerySnippetsPage />)

    await user.click(await screen.findByRole('button', { name: `Actions for ${MINE}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(stored(MINE)).toBe(true)
  })
})
