// Who may archive a query from its detail menu.
//
// Split out of query-source-menu.test.tsx, which is about what the menu offers
// for a given query STATE (draft, shared, safe). This file is about who is
// looking at it, which needs a signed-in identity the other file has no use for.
//
// The rule is admin-or-owner, not can_edit. QueryResource.delete is guarded by
// `require_admin_or_owner(query.user_id)` (node/redash/handlers/queries.py:431).
// can_edit is Redash's can_modify, `is_admin_or_owner(...) or
// user.has_access(obj, MODIFY)`, which is a strictly wider set. Gating on it
// offered an ACL editor an Archive that could only ever return 403.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { QuerySourceMenu } from './query-source-menu'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const target = mockQueries[0]
/** Nobody: far enough from every fixture id to never collide with an owner. */
const STRANGER = target.user.id + 500

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

function renderMenu(overrides: Partial<MockQuery> = {}) {
  renderWithProviders(
    <QuerySourceMenu
      query={{ ...target, can_edit: true, is_safe: true, ...overrides }}
      onOpenSchedule={vi.fn()}
      onOpenApiKey={vi.fn()}
      onOpenEmbed={vi.fn()}
      onOpenAddToDashboard={vi.fn()}
      onOpenPermissions={vi.fn()}
    />,
    { config: { features: { query_snippets: false, query_drafts: true } } }
  )
  return userEvent.setup()
}

beforeEach(() => signIn(target.user.id))

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

describe('QuerySourceMenu archive permission', () => {
  it('offers Archive to the author', async () => {
    const user = renderMenu()
    await user.click(screen.getByRole('button', { name: 'Query actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
  })

  it('offers Archive to an admin who did not write the query', async () => {
    signIn(STRANGER, true)
    const user = renderMenu()
    await user.click(screen.getByRole('button', { name: 'Query actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
  })

  it('hides Archive from an editor who may modify the query but may not archive it', async () => {
    // can_edit true and not the owner: the exact combination the old gate got
    // wrong, and the reason this file exists.
    signIn(STRANGER)
    const user = renderMenu({ can_edit: true })
    await user.click(screen.getByRole('button', { name: 'Query actions' }))

    // Positive control first. The items can_edit DOES govern are still there,
    // which proves the menu opened and that this is a targeted denial rather
    // than a component that rendered nothing.
    expect(await screen.findByRole('menuitem', { name: 'Permissions' })).toBeInTheDocument()
    expect(await screen.findByRole('menuitem', { name: 'Schedule' })).toBeInTheDocument()

    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
  })
})
