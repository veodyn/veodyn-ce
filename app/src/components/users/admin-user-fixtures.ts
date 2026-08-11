// Fixtures for the admin user list tests: rows in the shape Redash sends, and
// a small stateful backend behind the filter tabs and the row actions.
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import type { RedashUser } from './admin-user-list'
import type { Write } from './users-admin-fixtures'

export function userRow(over: Partial<RedashUser> = {}): RedashUser {
  return {
    id: 2,
    name: 'Jane Analyst',
    email: 'jane@example.com',
    profile_image_url: null,
    groups: [{ id: 2, name: 'default' }],
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    disabled_at: null,
    is_disabled: false,
    active_at: '2026-02-01T10:00:00Z',
    is_invitation_pending: false,
    is_email_verified: true,
    auth_type: 'password',
    ...over,
  }
}

interface ServeUsersOptions {
  /** Refuse every list request with this message. */
  failWith?: string
  /** Refuse only the first list request, so a retry can succeed. */
  failFirstLoad?: string
  failDisable?: boolean
}

/**
 * Serves the list behind the filter tabs plus the three row actions, and
 * records every write. The list is stateful, so disabling someone moves them
 * out of Active and into Disabled on the refetch the component issues, which
 * is the half a recorded request cannot show.
 */
export function serveUserList(rows: RedashUser[], opts: ServeUsersOptions = {}) {
  let state = [...rows]
  const writes: Write[] = []
  let loads = 0
  const refuse = (message: string) =>
    new HttpResponse(JSON.stringify({ message }), { status: 500 })

  server.use(
    http.get('/api/node/users', ({ request }) => {
      loads += 1
      if (opts.failWith) return refuse(opts.failWith)
      if (opts.failFirstLoad && loads === 1) return refuse(opts.failFirstLoad)

      const params = new URL(request.url).searchParams
      const wantPending = params.get('pending') === 'true'
      const wantDisabled = params.get('disabled') === 'true'
      const results = state.filter((u) => {
        if (wantPending) return u.is_invitation_pending
        if (wantDisabled) return u.is_disabled
        return !u.is_disabled && !u.is_invitation_pending
      })
      return HttpResponse.json({ count: results.length, page: 1, page_size: 25, results })
    }),
    http.post('/api/node/users/:userId/disable', ({ params }) => {
      const id = String(params.userId)
      writes.push({ method: 'POST', path: `/api/node/users/${id}/disable`, body: null })
      if (opts.failDisable) return refuse('backend refused')
      state = state.map((u) => (String(u.id) === id ? { ...u, is_disabled: true } : u))
      return HttpResponse.json({})
    }),
    http.delete('/api/node/users/:userId/disable', ({ params }) => {
      const id = String(params.userId)
      writes.push({ method: 'DELETE', path: `/api/node/users/${id}/disable`, body: null })
      state = state.map((u) => (String(u.id) === id ? { ...u, is_disabled: false } : u))
      return HttpResponse.json({})
    }),
    http.delete('/api/node/users/:userId', ({ params }) => {
      const id = String(params.userId)
      writes.push({ method: 'DELETE', path: `/api/node/users/${id}`, body: null })
      state = state.filter((u) => String(u.id) !== id)
      return HttpResponse.json({})
    })
  )

  return { writes, loadCount: () => loads }
}
