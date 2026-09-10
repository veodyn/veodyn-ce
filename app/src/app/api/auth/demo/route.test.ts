// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const PERSONAS = [
  { id: 'operations', label: 'Operations lead', email: 'demo-ops@example.com' },
  { id: 'analyst', label: 'Analyst', email: 'demo-analyst@example.com', description: 'Read only' },
]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

async function loadRoute(
  overrides: { personas?: unknown; password?: string; redashUrl?: string } = {}
) {
  const { personas = PERSONAS, password = 'demo-secret', redashUrl = 'http://redash.test' } =
    overrides
  vi.stubEnv('REDASH_URL', redashUrl)
  vi.stubEnv('DEMO_LOGIN_PASSWORD', password)
  vi.stubEnv('VEODYN_DEMO__PERSONAS', JSON.stringify(personas))
  vi.resetModules()
  return import('./route')
}

function demoRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function loginPage(csrf = 'csrf-123') {
  return new Response(`<input name="csrf_token" value="${csrf}">`, {
    status: 200,
    headers: { 'set-cookie': `csrf_token=${csrf}; Path=/` },
  })
}

const DEPLOYED_PERSONAS =
  '[{"id":"operations","label":"Operations lead","email":"demo-ops@veodyn.com","description":"Sees every dashboard, runs and saves queries"},{"id":"analyst","label":"Analyst","email":"demo-analyst@veodyn.com","description":"Writes queries against the catalog, cannot administer"},{"id":"viewer","label":"Viewer","email":"demo-viewer@veodyn.com","description":"Reads dashboards and reports, changes nothing"}]'

describe('the demo persona sign-in route', () => {
  it('loads a three-persona VEODYN_DEMO__PERSONAS of the shape a deployment sets', async () => {
    vi.stubEnv('REDASH_URL', 'http://redash.test')
    vi.stubEnv('DEMO_LOGIN_PASSWORD', 'demo-secret')
    vi.stubEnv('VEODYN_DEMO__PERSONAS', DEPLOYED_PERSONAS)
    vi.resetModules()
    const { POST } = await import('./route')

    const res = await POST(demoRequest({ persona: 'nobody' }))

    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/unknown demo persona/i)
  })

  it('is absent on an instance that configures no personas', async () => {
    const { POST } = await loadRoute({ personas: [] })

    const res = await POST(demoRequest({ persona: 'operations' }))

    expect(res.status).toBe(404)
  })

  it('refuses a persona id the instance does not declare', async () => {
    const { POST } = await loadRoute()

    const res = await POST(demoRequest({ persona: 'root' }))

    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/unknown demo persona/i)
  })

  it('refuses when the shared demo password is unset rather than signing in blank', async () => {
    const { POST } = await loadRoute({ password: '' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(demoRequest({ persona: 'operations' }))

    expect(res.status).toBe(503)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("signs in with the persona's own email and never a password from the caller", async () => {
    const { POST } = await loadRoute()
    const calls: Array<{ url: string; body?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body as string | undefined })
        if (String(url).endsWith('/login') && init?.method === 'POST') {
          return new Response(null, { status: 302, headers: { location: '/' } })
        }
        if (String(url).endsWith('/login')) return loginPage()
        if (String(url).endsWith('/api/session')) {
          return Response.json({ user: { id: 7, email: 'demo-analyst@example.com' } })
        }
        return Response.json({ api_key: 'k' })
      })
    )

    const res = await POST(demoRequest({ persona: 'analyst', password: 'attacker-supplied' }))

    expect(res.status).toBe(200)
    const form = new URLSearchParams(calls.find((c) => c.body)?.body ?? '')
    expect(form.get('email')).toBe('demo-analyst@example.com')
    expect(form.get('password')).toBe('demo-secret')
  })
})
