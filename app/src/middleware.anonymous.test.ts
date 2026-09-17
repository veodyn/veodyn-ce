import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { FeatureDescriptor } from '@/features/types'

const ORIGIN = 'https://veodyn.example'

const DECLARING: Record<string, FeatureDescriptor> = {
  messages: {
    id: 'messages',
    nav: [],
    routes: [],
    anonymousRoutes: [
      { path: '/service-alerts/public/[slug]' },
      { path: '/service-alerts/public/[slug]/banner', embeddable: true },
      { path: '/messages/public/[token]' },
    ],
  },
}

const DECLARING_NOTHING: Record<string, FeatureDescriptor> = {
  messages: { id: 'messages', nav: [], routes: [] },
}

const DECLARING_WHAT_IT_MAY_NOT: Record<string, FeatureDescriptor> = {
  rogue: {
    id: 'rogue',
    nav: [],
    routes: [],
    anonymousRoutes: [{ path: '/' }, { path: '/admin' }, { path: '/settings' }, { path: '/reports' }],
  },
}

async function loadMiddleware(registry: Record<string, FeatureDescriptor>) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'https://redash.example')
  vi.doMock('@/features/generated-registry', () => ({ FEATURES: registry }))
  return (await import('@/middleware')).middleware
}

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, ORIGIN), { headers: cookie ? { cookie } : undefined })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('@/features/generated-registry')
  vi.resetModules()
})

describe('a session-less route a feature package declares', () => {
  it.each([
    '/service-alerts/public/agency-one',
    '/service-alerts/public/agency-one/banner',
    '/messages/public/msg_abc',
  ])('lets %s through with no session', async (path) => {
    const middleware = await loadMiddleware(DECLARING)

    expect(middleware(request(path)).headers.get('location')).toBeNull()
  })

  it('frames only the declaration that asked to be framed', async () => {
    const middleware = await loadMiddleware(DECLARING)

    const banner = middleware(request('/service-alerts/public/agency-one/banner'))
    const canonical = middleware(request('/service-alerts/public/agency-one'))
    const preview = middleware(request('/messages/public/msg_abc'))

    expect(banner.headers.get('Content-Security-Policy')).toContain('frame-ancestors *')
    expect(canonical.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(preview.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })

  it.each([
    '/messages',
    '/messages/msg_abc',
    '/messages/new',
    '/messages/public',
    '/messages/publicity',
    '/messages/publications',
    '/messages/public/msg_abc/edit',
    '/service-alerts',
    '/service-alerts/public',
    '/service-alerts/public/agency-one/edit',
    '/service-alerts-admin',
  ])('still sends %s to sign in, because it was not the route that was declared', async (path) => {
    const middleware = await loadMiddleware(DECLARING)

    expect(middleware(request(path)).status).toBe(307)
  })

  it('sends every route of a package that declares nothing to sign in', async () => {
    const middleware = await loadMiddleware(DECLARING_NOTHING)

    expect(middleware(request('/service-alerts/public/agency-one')).status).toBe(307)
    expect(middleware(request('/messages/public/msg_abc')).status).toBe(307)
    expect(middleware(request('/messages')).status).toBe(307)
  })
})

describe('a declaration outside the allowed shape', () => {
  it.each(['/', '/admin/status', '/settings', '/reports/7'])(
    'is refused rather than honoured, so %s still redirects',
    async (path) => {
      const middleware = await loadMiddleware(DECLARING_WHAT_IT_MAY_NOT)

      expect(middleware(request(path)).status).toBe(307)
    }
  )
})

describe('the community routes, with a feature package installed alongside them', () => {
  it.each([
    '/login',
    '/invite/tok',
    '/reset/tok',
    '/embed/query/1/visualization/2',
    '/embed/public/abc',
    '/dashboards/public/abc',
    '/reports/public/abc',
    '/mcp',
  ])('leaves %s exactly as it was', async (path) => {
    const middleware = await loadMiddleware(DECLARING)

    expect(middleware(request(path)).headers.get('location')).toBeNull()
  })

  it.each([
    '/reports/publications',
    '/dashboards/publications',
    '/mcp-admin',
    '/mcpanything',
    '/loginhistory',
    '/embedded-reports',
    '/resets',
    '/admin/status',
    '/users',
  ])('still refuses %s exactly as it did', async (path) => {
    const middleware = await loadMiddleware(DECLARING)

    expect(middleware(request(path)).status).toBe(307)
  })

  it.each(['/embed', '/invite', '/reset', '/dashboards/public', '/reports/public'])(
    'refuses the bare root %s, which the shell never treated as anonymous either',
    async (path) => {
      const middleware = await loadMiddleware(DECLARING)

      expect(middleware(request(path)).status).toBe(307)
    }
  )

  it('still lets a request carrying a session through', async () => {
    const middleware = await loadMiddleware(DECLARING)

    expect(middleware(request('/users', 'session=abc123')).headers.get('location')).toBeNull()
  })

  it('still frames the community embeddable routes and nothing else', async () => {
    const middleware = await loadMiddleware(DECLARING)

    expect(middleware(request('/embed/public/abc')).headers.get('Content-Security-Policy')).toContain(
      'frame-ancestors *'
    )
    expect(middleware(request('/login')).headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'"
    )
  })
})
