// What the sign-in screen is allowed to tell the user.
//
// /api/auth/login already distinguishes a wrong password from a backend that is
// unreachable, rate limited, or not set up yet. The store used to throw all of
// that away and answer a bare `false`, so every one of them reached the user as
// "Login failed. Check your credentials." and sent them to reset a password
// that was never the problem.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const { useAuthStore } = await import('@/stores/auth-store')

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  useAuthStore.setState({
    currentUser: null,
    isAuthenticated: false,
    isLoading: false,
    loginError: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('what a failed sign-in reports', () => {
  it('passes the route message through instead of blaming the password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ message: 'The query service is not ready. Organization may need setup.' }, 503)
      )
    )

    expect(await useAuthStore.getState().login('a@example.com', 'pw')).toBe(false)
    expect(useAuthStore.getState().loginError).toBe(
      'The query service is not ready. Organization may need setup.'
    )
  })

  it('still says something specific when the response carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))

    expect(await useAuthStore.getState().login('a@example.com', 'pw')).toBe(false)
    expect(useAuthStore.getState().loginError).toMatch(/502/)
  })

  it('names an unreachable service rather than reporting bad credentials', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect(await useAuthStore.getState().login('a@example.com', 'pw')).toBe(false)
    expect(useAuthStore.getState().loginError).toMatch(/reach/i)
  })

  it('clears the previous failure when a new attempt starts', async () => {
    useAuthStore.setState({ loginError: 'Invalid email or password.' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/auth/login')) return jsonResponse({ user: { id: 7 } }, 200)
        return jsonResponse(
          { user: { id: 7, name: 'A', email: 'a@example.com', permissions: [] }, client_config: {}, messages: [] },
          200
        )
      })
    )

    expect(await useAuthStore.getState().login('a@example.com', 'pw')).toBe(true)
    expect(useAuthStore.getState().loginError).toBeNull()
  })

  it('does not report success when the session will not load behind it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/auth/login')) return jsonResponse({ user: { id: 7 } }, 200)
        return jsonResponse({ message: 'Please login to continue.' }, 401)
      })
    )

    expect(await useAuthStore.getState().login('a@example.com', 'pw')).toBe(false)
    expect(useAuthStore.getState().loginError).toBeTruthy()
  })
})
