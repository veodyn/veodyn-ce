import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGIN = 'https://veodyn.example'

async function loadMiddleware(landingPath: string | undefined) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'https://redash.example')
  vi.stubEnv('NEXT_PUBLIC_LANDING_PATH', landingPath ?? '')
  return (await import('@/middleware')).middleware
}

function request(path: string) {
  return new NextRequest(new URL(path, ORIGIN), { headers: { cookie: 'session=abc' } })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the landing path in middleware', () => {
  it('serves / as home when the flag is unset', async () => {
    const middleware = await loadMiddleware(undefined)

    expect(middleware(request('/')).headers.get('location')).toBeNull()
  })

  it('sends /home back to / when the flag is unset', async () => {
    const middleware = await loadMiddleware(undefined)

    const response = middleware(request('/home'))

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location') as string).pathname).toBe('/')
  })

  it('sends / to /home, keeping the query string, when the landing path is /home', async () => {
    const middleware = await loadMiddleware('/home')

    const response = middleware(request('/?tab=recent'))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') as string)
    expect(location.pathname).toBe('/home')
    expect(location.search).toBe('?tab=recent')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('serves /home itself when it is the landing path', async () => {
    const middleware = await loadMiddleware('/home')

    expect(middleware(request('/home')).headers.get('location')).toBeNull()
  })
})
