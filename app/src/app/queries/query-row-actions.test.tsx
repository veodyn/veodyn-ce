import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueriesPage from '@/app/queries/page'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const nav = vi.hoisted(() => ({ tab: 'all' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${nav.tab}`),
}))

vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: vi.fn(), success: vi.fn() }) }
})

// Who wrote the row under test. Ownership is an id comparison, so the author is
// a real user object on the fixture rather than a boolean on it.
const AUTHOR = { id: 501, name: 'Dana Author', email: 'dana@example.com' }
const STRANGER_ID = 502
const ADMIN_ID = 503

const base = { ...mockQueries[0], id: 7, name: 'Weekly revenue', can_edit: true, user: AUTHOR }

/** Every DELETE the page actually sent, which is what archiving a query is. */
let archived: number[] = []
let listed: MockQuery = { ...base }

function page(results: unknown[]) {
  return { count: results.length, page: 1, page_size: 25, results }
}

/**
 * A list row exactly as a real backend sends it. QuerySerializer emits no
 * can_edit at all, so the field is absent rather than false, and a gate that
 * read it would treat every author as a stranger.
 */
function withoutCanEdit(query: MockQuery): Record<string, unknown> {
  const row: Record<string, unknown> = { ...query }
  delete row.can_edit
  return row
}

function renderQueriesPage(): RenderResult {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: false } }}>
      <QueriesPage />
    </ConfigProvider>
  )
}

// Built the way the session response builds it, so isAdmin is derived from the
// permission list rather than asserted by the test, and canEdit is the real
// function the component calls rather than a stub that agrees with it.
function signIn(id: number, isAdmin: boolean) {
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({
      id,
      name: `User ${id}`,
      email: `user-${id}@example.com`,
      permissions: isAdmin ? ['admin', 'view_query'] : ['view_query'],
    }),
  })
}

/** The person who wrote Weekly revenue, and no kind of admin. */
const signInAsAuthor = () => signIn(AUTHOR.id, false)
/** A colleague with an account and no claim on this row. */
const signInAsStranger = () => signIn(STRANGER_ID, false)
/** An admin who did not write it. */
const signInAsAdmin = () => signIn(ADMIN_ID, true)

const kebab = () => screen.findByRole('button', { name: 'Actions for Weekly revenue' })
const noKebab = () =>
  expect(screen.queryByRole('button', { name: 'Actions for Weekly revenue' })).not.toBeInTheDocument()

beforeEach(() => {
  nav.tab = 'all'
  archived = []
  listed = { ...base }
  server.use(
    http.get('/api/node/queries', () => HttpResponse.json(page(nav.tab === 'all' ? [listed] : []))),
    http.get('/api/node/queries/archive', () =>
      HttpResponse.json(page(nav.tab === 'archive' ? [listed] : []))
    ),
    http.delete('/api/node/queries/7', () => {
      archived.push(7)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/node/queries/7', () => HttpResponse.json({ ...listed, is_archived: false }))
  )
})

afterEach(() => resetStores())

// The predicate mirrors what Redash will actually allow, which is narrower than
// it looks. QueryResource.delete (node/redash/handlers/queries.py:424-433) is
// guarded by require_admin_or_owner(query.user_id): an admin, or the row's own
// author, and nobody else. It is NOT require_object_modify_permission, so
// can_modify's `user.has_access(obj, MODIFY)` arm does not open it, and can_edit
// (the serialized answer to can_modify) is therefore the wrong question.
//
// can_edit is not even in this payload. Redash attaches it in QueryResource.get
// only (handlers/queries.py:402); the list endpoints serialize through
// QuerySerializer and never emit it, so on a real backend it is undefined here.
// The rows below deliberately carry a can_edit that disagrees with the expected
// outcome, so a gate that read it would fail these tests rather than pass them.
describe('who is offered the query row action', () => {
  it('offers nothing to someone who did not write it', async () => {
    signInAsStranger()
    // can_edit true and still refused: an ACL MODIFY grant sets this and still
    // gets a 403 from require_admin_or_owner.
    listed = { ...base, can_edit: true }

    renderQueriesPage()

    expect(await screen.findByText('Weekly revenue')).toBeInTheDocument()
    // Not a disabled item inside a kebab: an empty action list renders no
    // control at all, so there is nothing to click and nothing to explain.
    noKebab()
  })

  it('offers Archive to the author, who is not an admin', async () => {
    signInAsAuthor()
    // The payload a real backend sends: no can_edit anywhere on the row, so
    // ownership is the only thing that can carry this case.
    server.use(
      http.get('/api/node/queries', () => HttpResponse.json(page([withoutCanEdit(base)])))
    )
    const user = userEvent.setup()

    renderQueriesPage()
    await user.click(await kebab())

    // Destructive, and the counterpart to the Restore assertion below: without
    // this pair, either could pass on an item with no variant at all.
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toHaveAttribute(
      'data-variant',
      'destructive'
    )
  })

  it('offers Archive to an admin who did not write it', async () => {
    signInAsAdmin()
    listed = { ...base, can_edit: false }
    const user = userEvent.setup()

    renderQueriesPage()
    await user.click(await kebab())

    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
  })
})

describe('archiving a query from the list', () => {
  // The regression guard. Archive used to fire on a single click from the
  // query's own kebab with no confirmation at all, and what it fires is a
  // DELETE that Query.archive turns into a cascade.
  it('sends nothing until the confirmation is accepted', async () => {
    signInAsAuthor()
    const user = userEvent.setup()

    renderQueriesPage()
    await user.click(await kebab())
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    // The menu item opened a question, not a request.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(archived).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(archived).toEqual([7]))
  })

  it('sends nothing when the confirmation is dismissed', async () => {
    signInAsAuthor()
    const user = userEvent.setup()

    renderQueriesPage()
    await user.click(await kebab())
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(archived).toEqual([])
  })

  // Query.archive (node/redash/models/__init__.py:491-505) clears the
  // schedule, deletes every widget built on every one of the query's
  // visualizations and deletes every alert on it. Unarchiving restores none of
  // that, so a dialog that only said "you can restore it" would be false.
  it('says that the alerts and the widgets do not come back', async () => {
    signInAsAuthor()
    const user = userEvent.setup()

    renderQueriesPage()
    await user.click(await kebab())
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/alerts/i)
    expect(dialog).toHaveTextContent(/widgets/i)
    expect(dialog).toHaveTextContent(/Weekly revenue/)
  })
})

describe('the Archive tab', () => {
  it('offers Restore, and offers it as an ordinary action rather than a destructive one', async () => {
    nav.tab = 'archive'
    signInAsAuthor()
    listed = { ...base, is_archived: true }
    const user = userEvent.setup()

    renderQueriesPage()
    await user.click(await kebab())

    const restore = await screen.findByRole('menuitem', { name: 'Restore' })
    // Putting a query back loses nothing, so it must not be dressed in the red
    // reserved for the actions that do. Read off data-variant rather than the
    // class list: every item carries `data-[variant=destructive]:...` utilities
    // whatever its variant, so a substring check on className cannot fail.
    expect(restore).toHaveAttribute('data-variant', 'default')
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it('is the only tab that offers it', async () => {
    signInAsAuthor()
    const user = userEvent.setup()

    renderQueriesPage()
    await user.click(await kebab())

    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Restore' })).not.toBeInTheDocument()
  })
})
