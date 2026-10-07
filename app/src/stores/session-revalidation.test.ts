import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import { revalidateSessionAfter } from './session-revalidation'

const SIGNED_IN = { id: 7, name: 'Analyst' } as unknown as CurrentUser

function failedWith(status: number) {
  return new AppError(ErrorIds.CATALOG_FETCH_FAILED, 'catalog failed', { status })
}

function sessionAnswers(status: number) {
  return vi.fn(async () => new Response('{}', { status }))
}

describe('revalidateSessionAfter', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: SIGNED_IN, isAuthenticated: true, isLoading: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('signs the tab out when a 401 is confirmed by the session route', async () => {
    const fetchMock = sessionAnswers(401)
    vi.stubGlobal('fetch', fetchMock)

    await revalidateSessionAfter(failedWith(401))

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', { credentials: 'include' })
    expect(useAuthStore.getState()).toMatchObject({
      currentUser: null,
      isAuthenticated: false,
      isLoading: false,
    })
  })

  it('keeps the session when the session route still recognises it', async () => {
    vi.stubGlobal('fetch', sessionAnswers(200))

    await revalidateSessionAfter(failedWith(401))

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().currentUser).toBe(SIGNED_IN)
  })

  it('keeps the session when the session route is unreachable or failing', async () => {
    vi.stubGlobal('fetch', sessionAnswers(502))
    await revalidateSessionAfter(failedWith(401))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await revalidateSessionAfter(failedWith(401))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('does not ask on a 403, which is a permission answer for a known user', async () => {
    const fetchMock = sessionAnswers(401)
    vi.stubGlobal('fetch', fetchMock)

    await revalidateSessionAfter(failedWith(403))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('does not ask for an error that carries no status', async () => {
    const fetchMock = sessionAnswers(401)
    vi.stubGlobal('fetch', fetchMock)

    await revalidateSessionAfter(new Error('boom'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not ask when the tab holds no session, as on a public dashboard', async () => {
    useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: true })
    const fetchMock = sessionAnswers(401)
    vi.stubGlobal('fetch', fetchMock)

    await revalidateSessionAfter(failedWith(401))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isLoading).toBe(true)
  })

  it('asks once for a burst of 401s that land together', async () => {
    const fetchMock = sessionAnswers(401)
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([
      revalidateSessionAfter(failedWith(401)),
      revalidateSessionAfter(failedWith(401)),
      revalidateSessionAfter(failedWith(401)),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
