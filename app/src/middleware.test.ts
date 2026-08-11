// A cookie-less browser could open /users, /settings and /admin/status in a
// configured deployment: the shell rendered first and asked about the session
// afterwards. These pin the gate, and pin that it stays out of the way of mock
// mode and of the routes that exist for people with no session.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGIN = 'https://veodyn.example'

async function loadMiddleware(redashUrl: string | undefined) {
  vi.resetModules()
  // The module reads the flag once at import, so each mode needs its own import.
  vi.stubEnv('NEXT_PUBLIC_REDASH_URL', redashUrl ?? '')
  return (await import('@/middleware')).middleware
}

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, ORIGIN), {
    headers: cookie ? { cookie } : undefined,
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the session gate in a configured deployment', () => {
  it('sends a request with no session to sign in, keeping where it was headed', async () => {
    const middleware = await loadMiddleware('https://redash.example')

    const response = middleware(request('/admin/status'))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') as string)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/admin/status')
  })

  it('carries the query string into the return path', async () => {
    const middleware = await loadMiddleware('https://redash.example')

    const response = middleware(request('/queries?page=3'))

    const location = new URL(response.headers.get('location') as string)
    expect(location.searchParams.get('next')).toBe('/queries?page=3')
  })

  it('lets a request with a session through', async () => {
    const middleware = await loadMiddleware('https://redash.example')

    const response = middleware(request('/users', 'session=abc123'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('does not redirect the MCP endpoint, which authenticates for itself', async () => {
    // An MCP client sends a Redash API key, not a session cookie, and wants a
    // status code rather than an HTML sign-in page.
    const middleware = await loadMiddleware('https://redash.example')

    const response = middleware(request('/mcp'))

    expect(response.headers.get('location')).toBeNull()
  })

  it.each(['/login', '/invite/tok', '/reset/tok', '/embed/query/1',
    // The anonymous embed page. Covered by the existing '/embed' entry under
    // segment-boundary matching, so PUBLIC_ROUTES deliberately does not carry a
    // second entry for it; this case is what says so out loud.
    '/embed/public/abc',
    '/dashboards/public/abc', '/reports/public/abc'])(
    'leaves %s alone, since it is for people with no session',
    async (path) => {
      const middleware = await loadMiddleware('https://redash.example')

      const response = middleware(request(path))

      expect(response.headers.get('location')).toBeNull()
    }
  )

  it.each([
    // Analyst routes, not anonymous links.
    '/reports/publications',
    '/dashboards/publications',
    // A bare startsWith would have exempted every one of these from the gate,
    // silently, the moment someone added the route.
    '/mcp-admin',
    '/mcpanything',
    '/loginhistory',
    '/embedded-reports',
    '/resets',
  ])('does not mistake %s for a public route', async (path) => {
    const middleware = await loadMiddleware('https://redash.example')

    expect(middleware(request(path)).status).toBe(307)
  })
})

describe('mock mode', () => {
  it('is not gated, because signing itself in is the point of a demo', async () => {
    const middleware = await loadMiddleware(undefined)

    const response = middleware(request('/admin/status'))

    expect(response.headers.get('location')).toBeNull()
  })
})
