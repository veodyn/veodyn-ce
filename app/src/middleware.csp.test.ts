// The Content-Security-Policy the middleware attaches, and who is allowed to
// frame what. Before this the app sent no CSP, no HSTS and no framing control
// at all, and neither the charts nor the ingress supplied one.
//
// The nonce half is verified in a browser rather than here: a unit test can see
// that the header carries a nonce, but only a real page load shows whether Next
// stamped that nonce onto its own scripts and hydrated. It does; see the plan
// notes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGIN = 'https://veodyn.example'

async function loadMiddleware(nodeEnv: string, redashUrl = 'https://redash.example') {
  vi.resetModules()
  // Both are read once at module load, so each combination needs its own import.
  vi.stubEnv('NEXT_PUBLIC_REDASH_URL', redashUrl)
  vi.stubEnv('NODE_ENV', nodeEnv)
  return (await import('@/middleware')).middleware
}

function request(path: string, cookie = 'session=abc') {
  return new NextRequest(new URL(path, ORIGIN), { headers: { cookie } })
}

function csp(response: Response): string {
  return response.headers.get('content-security-policy') ?? ''
}

function directive(response: Response, name: string): string {
  const found = csp(response)
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name)
  return found ?? ''
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('content security policy', () => {
  it('sends one, with a nonce', async () => {
    const middleware = await loadMiddleware('production')

    const response = middleware(request('/queries'))

    expect(directive(response, 'script-src')).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
    expect(directive(response, 'default-src')).toBe("default-src 'self'")
    expect(directive(response, 'object-src')).toBe("object-src 'none'")
    expect(directive(response, 'base-uri')).toBe("base-uri 'self'")
  })

  it('gives every request a different nonce', async () => {
    const middleware = await loadMiddleware('production')

    const first = directive(middleware(request('/queries')), 'script-src')
    const second = directive(middleware(request('/queries')), 'script-src')

    expect(first).not.toBe(second)
  })

  it('refuses framing on an ordinary page', async () => {
    const middleware = await loadMiddleware('production')

    expect(directive(middleware(request('/queries')), 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })

  it('refuses framing on the sign-in page, which is reachable without a session', async () => {
    // Public is not the same as embeddable. A framed sign-in form is the
    // clickjacking case, so /login must not inherit the embed exemption.
    const middleware = await loadMiddleware('production')

    expect(directive(middleware(request('/login', '')), 'frame-ancestors')).toBe("frame-ancestors 'none'")
  })

  it.each(['/embed/query/1', '/dashboards/public/tok3n', '/reports/public/tok3n'])(
    'allows framing on %s, because being embedded is the point',
    async (path) => {
      const middleware = await loadMiddleware('production')

      expect(directive(middleware(request(path, '')), 'frame-ancestors')).toBe('frame-ancestors *')
    }
  )

  it('allows any https image, because two features take an author-supplied URL', async () => {
    // A result cell renders a URL the query author wrote and an avatar renders
    // one a user set. Neither host is knowable here, and restricting this to
    // self blanked both silently.
    const middleware = await loadMiddleware('production')

    const img = directive(middleware(request('/queries/1')), 'img-src')

    expect(img).toContain('https:')
    expect(img).toContain('data:')
    // Plain http stays refused; that is the half worth keeping.
    expect(img).not.toContain(' http:')
  })

  it('drops unsafe-eval outside development', async () => {
    const dev = await loadMiddleware('development')
    const prod = await loadMiddleware('production')

    expect(directive(dev(request('/queries')), 'script-src')).toContain("'unsafe-eval'")
    expect(directive(prod(request('/queries')), 'script-src')).not.toContain("'unsafe-eval'")
  })

  it('attaches the policy to the sign-in redirect too', async () => {
    // The redirect is a response like any other. One that skipped this would be
    // a response with no CSP, on the path an unauthenticated visitor takes.
    const middleware = await loadMiddleware('production')

    const response = middleware(request('/queries', ''))

    expect(response.status).toBe(307)
    expect(csp(response)).toContain('default-src')
  })

  it('attaches the policy in mock mode, which is a real deployment', async () => {
    const middleware = await loadMiddleware('production', '')

    expect(csp(middleware(request('/queries', '')))).toContain('default-src')
  })

  it('names the telemetry host in connect-src when one is configured', async () => {
    vi.stubEnv('POSTHOG_HOST', 'https://telemetry.example')
    const middleware = await loadMiddleware('production')

    expect(directive(middleware(request('/queries')), 'connect-src')).toContain('https://telemetry.example')
  })

  // Carto serves the style JSON the map renderers hardcode from
  // basemaps.cartocdn.com and the TileJSON, tiles, sprite and glyphs it points
  // at from tiles.basemaps.cartocdn.com. Allowing only the first rendered every
  // map on stage as bare geometry over white.
  it('names the origin the basemap subresources come from, not just the style', async () => {
    const middleware = await loadMiddleware('production')

    const connect = directive(middleware(request('/dashboards/5')), 'connect-src')

    expect(connect).toContain('https://basemaps.cartocdn.com')
    expect(connect).toContain('https://*.basemaps.cartocdn.com')
  })

  it('names a configured tile host in connect-src', async () => {
    vi.stubEnv('VEODYN_MAP__TILE_URL', 'https://tiles.example/style.json')
    const middleware = await loadMiddleware('production')

    expect(directive(middleware(request('/dashboards/5')), 'connect-src')).toContain('https://tiles.example')
  })
})
