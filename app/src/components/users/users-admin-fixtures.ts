// Fixtures for the users/groups admin tests: a session at a known permission
// level, and the small backend a GroupDetail talks to. Extracted so the test
// files hold assertions rather than object literals and handler lists.
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'

export const GROUP_ID = 7

export interface GroupFixture {
  id: number
  name: string
  type: 'builtin' | 'regular'
  permissions: string[]
}

export interface MemberFixture {
  id: number
  name: string
  email: string
  profile_image_url: string | null
}

export interface DataSourceFixture {
  id: number
  name: string
  type: string
  view_only: boolean
}

/**
 * Signs a session in through buildCurrentUser, the same function the session
 * response goes through, so `isAdmin` is DERIVED from the permission list
 * rather than asserted by the test. A hand-built object can claim
 * `isAdmin: true` with no admin permission on it, which no real session can,
 * and every permission assertion below would then be testing the fixture.
 */
export function signIn(id: number, isAdmin: boolean) {
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({
      id,
      name: `User ${id}`,
      email: `user-${id}@example.com`,
      permissions: isAdmin ? ['admin', 'list_users'] : ['view_query', 'list_dashboards'],
    }),
  })
}

/** Someone who administers the instance. */
export const signInAsAdmin = (id = 1) => signIn(id, true)
/** Someone with an account and no admin claim on anything. */
export const signInAsMember = (id = 2) => signIn(id, false)

export function member(over: Partial<MemberFixture> = {}): MemberFixture {
  return {
    id: 2,
    name: 'Jane Analyst',
    email: 'jane@example.com',
    profile_image_url: null,
    ...over,
  }
}

export function dataSource(over: Partial<DataSourceFixture> = {}): DataSourceFixture {
  return { id: 11, name: 'Production PostgreSQL', type: 'pg', view_only: false, ...over }
}

/** A backend that answers, and refuses. Not a network error: a real 500 with a
 * message, which is what the client turns into the text a toast shows. */
const refuse = () => new HttpResponse('{"message":"backend refused"}', { status: 500 })

/** The one status that means the group is genuinely not there, as opposed to
 * unreachable or forbidden. The client turns it into an ApiError carrying 404,
 * which is the only thing that separates a missing group from a failed load. */
const missing = () => new HttpResponse('{"message":"Not Found"}', { status: 404 })

/** How the three GETs on mount answer: normally, refused, or 404. */
function groupGet(
  opts: { failLoad?: boolean; notFound?: boolean },
  body: GroupFixture | MemberFixture[] | DataSourceFixture[]
) {
  if (opts.notFound) return missing()
  if (opts.failLoad) return refuse()
  return HttpResponse.json(body)
}

/** One write the component sent, recorded so a guarded action can be proven. */
export interface Write {
  method: string
  path: string
  body: unknown
}

interface ServeGroupOptions {
  group?: Partial<GroupFixture>
  members?: MemberFixture[]
  dataSources?: DataSourceFixture[]
  allDataSources?: Array<{ id: number; name: string }>
  /** The directory the admin's member search reads, matched on name. */
  allUsers?: Array<{ id: number; name: string; email: string }>
  /** Refuse the initial GETs, the way an unreachable backend does. */
  failLoad?: boolean
  /** Answer the initial GETs with a 404, the way a deleted group id does. */
  notFound?: boolean
  failRename?: boolean
  failDelete?: boolean
  failAddMember?: boolean
  failRemoveMember?: boolean
}

/**
 * Serves the three GETs GroupDetail issues on mount plus the writes it can
 * send, and records every write. Recording rather than counting requests:
 * "the DELETE never went out" is the assertion a confirmation guard needs, and
 * a spy on the client would still pass if the component called a different
 * path.
 */
export function serveGroup(opts: ServeGroupOptions = {}) {
  const group: GroupFixture = {
    id: GROUP_ID,
    name: 'Data Team',
    type: 'regular',
    permissions: ['view_query'],
    ...opts.group,
  }
  const state = {
    group,
    members: opts.members ?? [],
    dataSources: opts.dataSources ?? [],
  }
  const writes: Write[] = []
  const base = `/api/node/groups/${group.id}`

  server.use(
    http.get(base, () => groupGet(opts, state.group)),
    http.get(`${base}/members`, () => groupGet(opts, state.members)),
    http.get(`${base}/data_sources`, () => groupGet(opts, state.dataSources)),
    http.get('/api/node/data_sources', () => HttpResponse.json(opts.allDataSources ?? [])),
    http.get('/api/node/users', ({ request }) => {
      const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase()
      const results = (opts.allUsers ?? []).filter((u) => u.name.toLowerCase().includes(q))
      return HttpResponse.json({ count: results.length, results })
    }),
    http.post(base, async ({ request }) => {
      const body = (await request.json()) as { name?: string }
      writes.push({ method: 'POST', path: base, body })
      if (opts.failRename) return refuse()
      state.group = { ...state.group, name: String(body.name) }
      return HttpResponse.json(state.group)
    }),
    http.post(`${base}/members`, async ({ request }) => {
      const body = (await request.json()) as { user_id?: number }
      writes.push({ method: 'POST', path: `${base}/members`, body })
      if (opts.failAddMember) return refuse()
      const added = opts.allUsers?.find((u) => u.id === body.user_id)
      if (added) state.members = [...state.members, member(added)]
      return HttpResponse.json({})
    }),
    http.post(`${base}/data_sources`, async ({ request }) => {
      const body = (await request.json()) as { data_source_id?: number }
      writes.push({ method: 'POST', path: `${base}/data_sources`, body })
      const added = opts.allDataSources?.find((ds) => ds.id === body.data_source_id)
      if (added) state.dataSources = [...state.dataSources, dataSource(added)]
      return HttpResponse.json({})
    }),
    http.post(`${base}/data_sources/:dsId`, async ({ request, params }) => {
      const body = (await request.json()) as { view_only?: boolean }
      writes.push({ method: 'POST', path: `${base}/data_sources/${String(params.dsId)}`, body })
      return HttpResponse.json({})
    }),
    http.delete(`${base}/data_sources/:dsId`, ({ params }) => {
      const path = `${base}/data_sources/${String(params.dsId)}`
      writes.push({ method: 'DELETE', path, body: null })
      state.dataSources = state.dataSources.filter((ds) => String(ds.id) !== params.dsId)
      return HttpResponse.json({})
    }),
    http.delete(base, () => {
      writes.push({ method: 'DELETE', path: base, body: null })
      return opts.failDelete ? refuse() : HttpResponse.json({})
    }),
    http.delete(`${base}/members/:userId`, ({ params }) => {
      const path = `${base}/members/${String(params.userId)}`
      writes.push({ method: 'DELETE', path, body: null })
      if (opts.failRemoveMember) return refuse()
      state.members = state.members.filter((m) => String(m.id) !== params.userId)
      return HttpResponse.json({})
    })
  )

  return { group, writes, state }
}

/** A row of the group list, which carries a created_at the detail shape lacks. */
export interface GroupRow extends GroupFixture {
  created_at: string
}

export function groupRow(over: Partial<GroupRow> = {}): GroupRow {
  return {
    id: 3,
    name: 'Data Team',
    type: 'regular',
    permissions: ['view_query'],
    created_at: '2026-01-15T10:00:00Z',
    ...over,
  }
}

/**
 * Serves the group list and the two writes it can send, recording both. The
 * list is stateful so a delete or a create shows up in the refetch the
 * component issues afterwards, which is the half a request assertion alone
 * cannot see.
 */
export function serveGroupList(
  rows: GroupRow[],
  opts: { failCreate?: boolean; failDelete?: boolean } = {}
) {
  let state = [...rows]
  const writes: Write[] = []

  server.use(
    http.get('/api/node/groups', () => HttpResponse.json(state)),
    http.post('/api/node/groups', async ({ request }) => {
      const body = (await request.json()) as { name?: string }
      writes.push({ method: 'POST', path: '/api/node/groups', body })
      if (opts.failCreate) return refuse()
      const created = groupRow({ id: 99, name: String(body.name) })
      state = [...state, created]
      return HttpResponse.json(created)
    }),
    http.delete('/api/node/groups/:groupId', ({ params }) => {
      const id = String(params.groupId)
      writes.push({ method: 'DELETE', path: `/api/node/groups/${id}`, body: null })
      if (opts.failDelete) return refuse()
      state = state.filter((g) => String(g.id) !== id)
      return HttpResponse.json({})
    })
  )

  return { writes }
}

/** The newest toast sonner is showing of the given type, or null. */
export function toastOfType(type: 'success' | 'error'): HTMLElement | null {
  return document.querySelector(`[data-sonner-toast][data-type="${type}"]`)
}
