// Shared body for the /api/admin/* route suites.
//
// These routes reach Redash with the internal API key, which acts as its
// OWNING user (a super admin), never as the caller. The gate in front of it is
// the only thing standing between an org admin and an instance-wide endpoint,
// so these suites stub `fetch` and nothing else: the real gate runs, hits a
// stubbed /api/session, and decides. Mocking `requireAdmin`/`requirePermission`
// away is what let the confused-deputy bug live here for as long as it did.
// A suite that mocks the gate can only assert the route calls it, which was
// true of the vulnerable code too.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'
import type { InternalKeyPath } from '@/lib/redash-server'

export const REDASH = 'https://redash.example'
export const INTERNAL_KEY = 'internal-key-abc'

/** A Redash session with `admin` and nothing stronger: the escalation case. */
export const PLAIN_ADMIN = ['admin', 'create_query', 'list_users']
/** What Redash's builtin admin group actually carries (Group.ADMIN_PERMISSIONS). */
export const SUPER_ADMIN = ['admin', 'super_admin']

interface FetchCall {
  url: string
  headers: Record<string, string>
}

function callsOf(spy: MockInstance<typeof fetch>): FetchCall[] {
  return spy.mock.calls.map(([input, init]) => ({
    url: String(input),
    headers: ((init?.headers ?? {}) as Record<string, string>) ?? {},
  }))
}

/**
 * Stub the Redash backend: `/api/session` answers with `permissions` (or 401
 * when null), and anything else answers `upstream`.
 */
function stubRedash(permissions: string[] | null, upstream: unknown): MockInstance<typeof fetch> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    if (String(input).endsWith('/api/session')) {
      return Promise.resolve(
        permissions === null
          ? new Response('{}', { status: 401 })
          : Response.json({ user: { id: 7, permissions } })
      )
    }
    return Promise.resolve(Response.json(upstream))
  })
}

export interface InternalKeyRouteSuite {
  label: string
  /** The Redash path the route proxies, as registered in INTERNAL_KEY_ENDPOINTS. */
  redashPath: InternalKeyPath
  /** The app-side URL the browser calls. */
  routeUrl: string
  /** A plausible body for the Redash endpoint. */
  upstreamBody: unknown
  /** Re-import the route module against the env set up here. */
  loadRoute: () => Promise<{ GET: (request: NextRequest) => Promise<Response> | Response }>
}

export function testsForInternalKeyRoute(suite: InternalKeyRouteSuite): void {
  const request = (headers: Record<string, string> = {}) => new NextRequest(suite.routeUrl, { headers })
  const upstreamCalls = (spy: MockInstance<typeof fetch>) =>
    callsOf(spy).filter((c) => !c.url.endsWith('/api/session'))

  describe(suite.label, () => {
    beforeEach(() => {
      process.env.REDASH_URL = REDASH
      process.env.REDASH_INTERNAL_API_KEY = INTERNAL_KEY
      // The legacy fallback getInternalApiKey still honours. Cleared so a
      // developer's own shell cannot decide whether the no-key case holds.
      delete process.env.REDASH_API_KEY
    })

    afterEach(() => {
      vi.restoreAllMocks()
      delete process.env.REDASH_URL
      delete process.env.REDASH_INTERNAL_API_KEY
    })

    // The defect this suite exists for. Redash gates this endpoint with
    // @require_super_admin, so an org admin asking Redash directly is refused;
    // asking us must not be the way around that.
    it('refuses a plain org admin and never presents the internal key', async () => {
      const spy = stubRedash(PLAIN_ADMIN, suite.upstreamBody)
      const { GET } = await suite.loadRoute()

      const res = await GET(request({ cookie: 'session=plain-admin' }))

      expect(res.status).toBe(403)
      expect((await res.json()).message).toBe('Super admin permission required.')
      expect(upstreamCalls(spy)).toEqual([])
      expect(JSON.stringify(callsOf(spy))).not.toContain(INTERNAL_KEY)
    })

    it('serves a super admin, with the internal key and not the caller cookie', async () => {
      const spy = stubRedash(SUPER_ADMIN, suite.upstreamBody)
      const { GET } = await suite.loadRoute()

      const res = await GET(request({ cookie: 'session=super-admin' }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(suite.upstreamBody)
      const [upstream, ...rest] = upstreamCalls(spy)
      expect(rest).toEqual([])
      expect(upstream.url).toBe(`${REDASH}${suite.redashPath}`)
      expect(upstream.headers['Authorization']).toBe(`Key ${INTERNAL_KEY}`)
      expect(upstream.headers['Cookie']).toBeUndefined()
    })

    it('refuses a caller Redash does not recognise', async () => {
      const spy = stubRedash(null, suite.upstreamBody)
      const { GET } = await suite.loadRoute()

      const res = await GET(request({ cookie: 'session=expired' }))

      expect(res.status).toBe(403)
      expect(upstreamCalls(spy)).toEqual([])
    })

    it('refuses an anonymous caller without asking Redash anything', async () => {
      const spy = stubRedash(SUPER_ADMIN, suite.upstreamBody)
      const { GET } = await suite.loadRoute()

      const res = await GET(request())

      expect(res.status).toBe(403)
      expect(spy).not.toHaveBeenCalled()
    })

    it('answers 503 rather than reaching a backend it has no URL for', async () => {
      delete process.env.REDASH_URL
      const spy = stubRedash(SUPER_ADMIN, suite.upstreamBody)
      const { GET } = await suite.loadRoute()

      const res = await GET(request({ cookie: 'session=super-admin' }))

      expect(res.status).toBe(503)
      expect(spy).not.toHaveBeenCalled()
    })

    it('answers 503 rather than calling Redash unauthenticated when no key is configured', async () => {
      delete process.env.REDASH_INTERNAL_API_KEY
      const spy = stubRedash(SUPER_ADMIN, suite.upstreamBody)
      const { GET } = await suite.loadRoute()

      const res = await GET(request({ cookie: 'session=super-admin' }))

      expect(res.status).toBe(503)
      expect(upstreamCalls(spy)).toEqual([])
    })
  })
}
