import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { mockQueries } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueriesPage from '@/app/queries/page'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=archive'),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: toastError, success: toastSuccess }) }
})

// Who wrote Old Summary. Restoring it is owner-or-admin, and ownership is an id
// comparison, so the author has to be a user object on the row.
const AUTHOR = { id: 501, name: 'Dana Author', email: 'dana@example.com' }
const STRANGER_ID = 502
const ADMIN_ID = 503

const archived = {
  ...mockQueries[0],
  id: 42,
  name: 'Old Summary',
  is_archived: true,
  can_edit: true,
  user: AUTHOR,
}

// Built the way the session response builds it, so isAdmin comes off the
// permission list and canEdit is the real function the row menu calls.
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

const signInAsAuthor = () => signIn(AUTHOR.id, false)
const signInAsStranger = () => signIn(STRANGER_ID, false)
const signInAsAdmin = () => signIn(ADMIN_ID, true)

// The header now mounts CreateWithAiButton, which reads instance config, so the
// page needs a ConfigProvider to render at all. AI off is the demo posture and
// the one every test here cares about: the button renders null, so the archive
// tab is exactly the page it was. The Create-with-AI entry point itself is
// covered in app/library-ai-entry.test.tsx.
function renderQueriesPage(): RenderResult {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: false } }}>
      <QueriesPage />
    </ConfigProvider>
  )
}

beforeEach(() => {
  toastError.mockClear()
  toastSuccess.mockClear()
  // The author is the default viewer: the restore mechanics below are about
  // what the request carries, and only someone who may restore ever gets there.
  signInAsAuthor()
  server.use(
    http.get('/api/node/queries/archive', () =>
      HttpResponse.json({ count: 1, page: 1, page_size: 25, results: [archived] })
    ),
    http.get('/api/node/queries', () =>
      HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
    )
  )
})

afterEach(() => resetStores())

// Restore moved into the shared row menu, so reaching it is now two clicks: the
// kebab, then the item. The kebab names the row it belongs to, because a table
// of twenty otherwise offers twenty buttons all called "Actions".
async function openRestore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Actions for Old Summary' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Restore' }))
}

const kebab = () => screen.queryByRole('button', { name: 'Actions for Old Summary' })

describe('archived queries', () => {
  // Archiving was a one-way trip through the UI: the tab listed the query and
  // offered nothing to do with it.
  it('restores an archived query by clearing is_archived', async () => {
    const user = userEvent.setup()
    let body: unknown
    server.use(
      http.post('/api/node/queries/42', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ...archived, is_archived: false })
      })
    )

    renderQueriesPage()

    await openRestore(user)

    // Redash exposes no unarchive endpoint; is_archived is an ordinary field
    // its update handler does not strip.
    await waitFor(() => expect(body).toEqual({ is_archived: false }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('reports a refused restore rather than appearing to succeed', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/node/queries/42', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
      )
    )

    renderQueriesPage()
    await openRestore(user)

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

// Who may take a query back off this tab. Restore is a write to the query, and
// Redash gates the archive side of that pair with
// require_admin_or_owner(query.user_id) (handlers/queries.py:424-433): an admin,
// or the query's own author. Not require_object_modify_permission, so an ACL
// MODIFY grant does not open it, and not can_edit, which serializes can_modify
// and is in any case absent from this list payload (QuerySerializer never emits
// it). Every row below carries a can_edit that disagrees with the expected
// outcome, so a gate that read it would fail here rather than pass.
describe('who is offered the restore', () => {
  it('offers it to the author, who is not an admin', async () => {
    renderQueriesPage()

    expect(await screen.findByText('Old Summary')).toBeInTheDocument()
    expect(kebab()).toBeInTheDocument()
  })

  it('offers nothing to someone who did not write it', async () => {
    signInAsStranger()
    server.use(
      http.get('/api/node/queries/archive', () =>
        HttpResponse.json({
          count: 1,
          page: 1,
          page_size: 25,
          // can_edit true and still refused: that is exactly the ACL MODIFY
          // grant the archive endpoint turns away with a 403.
          results: [{ ...archived, can_edit: true }],
        })
      )
    )

    renderQueriesPage()

    expect(await screen.findByText('Old Summary')).toBeInTheDocument()
    // No kebab either, not a kebab holding a disabled item: an empty action
    // list renders no control at all.
    expect(kebab()).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('offers it to an admin who did not write it', async () => {
    signInAsAdmin()
    server.use(
      http.get('/api/node/queries/archive', () =>
        HttpResponse.json({
          count: 1,
          page: 1,
          page_size: 25,
          results: [{ ...archived, can_edit: false }],
        })
      )
    )

    renderQueriesPage()

    expect(await screen.findByText('Old Summary')).toBeInTheDocument()
    expect(kebab()).toBeInTheDocument()
  })
})
