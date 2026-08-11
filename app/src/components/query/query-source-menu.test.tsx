import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { QuerySourceMenu } from './query-source-menu'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const target = mockQueries[0]

/**
 * Archive is gated on admin-or-owner rather than on can_edit, because
 * QueryResource.delete is require_admin_or_owner. So these tests have to say
 * who is signed in; can_edit on the row is not enough and should not be.
 */
function signIn(id: number, isAdmin = false) {
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({
      id,
      name: 'Signed in',
      email: 'signed-in@example.com',
      permissions: isAdmin ? ['admin', 'view_query'] : ['view_query'],
    }),
  })
}

beforeEach(() => signIn(target.user.id))

afterEach(() => {
  resetStores()
  // resetStores leaves the query rows alone, and these tests both edit them and
  // add to them (Fork), so the whole set goes back or the next test inherits a
  // flipped is_draft and a stray "Copy of" row.
  useMockDataStore.setState({ queries: mockQueries })
  push.mockReset()
})

// `features` is one object, so a partial override replaces the whole of it and
// every key it holds has to be named.
function features(queryDrafts: boolean) {
  return { config: { features: { query_snippets: false, query_drafts: queryDrafts } } }
}

function renderMenu(overrides: Partial<MockQuery> = {}, queryDrafts = true) {
  renderWithProviders(
    <QuerySourceMenu
      query={{ ...target, can_edit: true, is_safe: true, ...overrides }}
      onOpenSchedule={vi.fn()}
      onOpenApiKey={vi.fn()}
      onOpenEmbed={vi.fn()}
      onOpenAddToDashboard={vi.fn()}
      onOpenPermissions={vi.fn()}
    />,
    features(queryDrafts)
  )
  return userEvent.setup()
}

const stored = () => useMockDataStore.getState().queries.find((q) => q.id === target.id)
const newest = () => useMockDataStore.getState().queries.at(-1)

describe('QuerySourceMenu', () => {
  it('renders actions for the current query state and invokes the selected action', async () => {
    const user = userEvent.setup()
    const onOpenSchedule = vi.fn()

    renderWithProviders(
      <QuerySourceMenu
        query={{ ...target, can_edit: true, is_draft: false, is_safe: true }}
        onOpenSchedule={onOpenSchedule}
        onOpenApiKey={vi.fn()}
        onOpenEmbed={vi.fn()}
        onOpenAddToDashboard={vi.fn()}
        onOpenPermissions={vi.fn()}
      />,
      features(true)
    )

    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Fork' })).toBeInTheDocument()
    })

    for (const label of [
      'Fork',
      'Make it a draft',
      'Schedule',
      'API Key',
      'Embed',
      'Add to Dashboard',
      'Permissions',
      'Archive',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }

    await user.click(screen.getByRole('menuitem', { name: 'Schedule' }))

    expect(onOpenSchedule).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menuitem', { name: 'Schedule' })).not.toBeInTheDocument()
  })

  // "Publish" under a globe claimed an audience this action does not touch, and
  // "Publish to query list" named a UI surface rather than the people on the
  // other side of it. What changes is who finds the query, so the label says
  // who.
  it('names the audience rather than the mechanism', async () => {
    const user = renderMenu({ is_draft: true })

    await user.click(screen.getByRole('button'))

    const item = await screen.findByRole('menuitem', { name: 'Share with the team' })
    // People, not a list widget. The glyph is half the label at a glance, and a
    // list icon said the same wrong thing "Publish to query list" did.
    expect(item.querySelector('svg')).toHaveClass('lucide-users')
    expect(screen.queryByRole('menuitem', { name: /publish/i })).not.toBeInTheDocument()
  })

  it('offers the reverse under a pen, since going back is going back to writing', async () => {
    const user = renderMenu({ is_draft: false })

    await user.click(screen.getByRole('button'))

    const item = await screen.findByRole('menuitem', { name: 'Make it a draft' })
    expect(item.querySelector('svg')).toHaveClass('lucide-pen-line')
  })

  it('shares a draft with the team', async () => {
    useMockDataStore.getState().updateQuery(target.id, { is_draft: true })
    const user = renderMenu({ is_draft: true })

    await user.click(screen.getByRole('button'))
    await user.click(await screen.findByRole('menuitem', { name: 'Share with the team' }))

    await waitFor(() => expect(stored()?.is_draft).toBe(false))
  })

  it('takes a shared query back to a draft', async () => {
    useMockDataStore.getState().updateQuery(target.id, { is_draft: false })
    const user = renderMenu({ is_draft: false })

    await user.click(screen.getByRole('button'))
    await user.click(await screen.findByRole('menuitem', { name: 'Make it a draft' }))

    await waitFor(() => expect(stored()?.is_draft).toBe(true))
  })

  it('offers neither to someone who cannot edit the query', async () => {
    const user = renderMenu({ can_edit: false, is_draft: true })

    await user.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Fork' })).toBeInTheDocument())
    expect(screen.queryByRole('menuitem', { name: /share with the team|make it a draft/i }))
      .not.toBeInTheDocument()
  })
})

// The default. With the draft workflow off, saving already puts a query in
// front of the team, so this item would be the only way to take one back out of
// the shared list and the only place the word "draft" appears.
describe('QuerySourceMenu with the draft workflow off', () => {
  it('offers no way to draft a shared query', async () => {
    const user = renderMenu({ is_draft: false }, false)

    await user.click(screen.getByRole('button'))

    // The menu opened, so the absences below are real absences.
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Fork' })).toBeInTheDocument())
    expect(screen.queryByRole('menuitem', { name: 'Make it a draft' })).not.toBeInTheDocument()
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument()
  })

  it('offers no way to share a query that is somehow still a draft', async () => {
    // The state is reachable through a stored row whatever the flag says, and
    // the menu must not put a control back on screen for it.
    const user = renderMenu({ is_draft: true }, false)

    await user.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Fork' })).toBeInTheDocument())
    expect(screen.queryByRole('menuitem', { name: 'Share with the team' })).not.toBeInTheDocument()
  })

  it('shares the copy a fork makes, which Redash mints as a draft', async () => {
    // Otherwise Fork is a way to make a query nobody but its author can find,
    // with nothing in the product able to undo it.
    const user = renderMenu({}, false)

    await user.click(screen.getByRole('button'))
    await user.click(await screen.findByRole('menuitem', { name: 'Fork' }))

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(newest()?.name).toMatch(/^Copy of /)
    expect(newest()?.is_draft).toBe(false)
  })
})

describe('QuerySourceMenu archive confirmation', () => {
  it('archives nothing until the confirmation is accepted', async () => {
    const user = renderMenu({ is_archived: false })

    await user.click(screen.getByRole('button', { name: 'Query actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    // The click asked a question. It must not have sent the DELETE.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(stored()?.is_archived).toBe(false)
    expect(push).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(stored()?.is_archived).toBe(true))
    // Back to the list, because the page behind the dialog now shows a query
    // that is no longer in anyone's library.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/queries'))
  })

  it('archives nothing when the confirmation is dismissed', async () => {
    const user = renderMenu({ is_archived: false })

    await user.click(screen.getByRole('button', { name: 'Query actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(stored()?.is_archived).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('names the alerts and the widgets that will not come back', async () => {
    const user = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Query actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(target.name)
    expect(dialog).toHaveTextContent(/alerts/i)
    expect(dialog).toHaveTextContent(/widgets/i)
    // The query itself survives, and the dialog has to say which half is which
    // or "will not come back" reads as being about the query.
    expect(dialog).toHaveTextContent(/restored/i)
  })
})

describe('QuerySourceMenu with the draft workflow on', () => {
  it('leaves the copy a fork makes as a draft, for its author to share', async () => {
    // The other direction, so the un-drafting above cannot be unconditional.
    const user = renderMenu({}, true)

    await user.click(screen.getByRole('button'))
    await user.click(await screen.findByRole('menuitem', { name: 'Fork' }))

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(newest()?.name).toMatch(/^Copy of /)
    expect(newest()?.is_draft).toBe(true)
  })
})
