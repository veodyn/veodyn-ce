import { beforeEach, describe, expect, it } from 'vitest'
import { hydrateSession, useAuthStore } from '@/stores/auth-store'
import type { SessionPayload } from '@/stores/auth-identity'

const PAYLOAD: SessionPayload = {
  user: { id: 7, name: 'Ada', email: 'ada@example.test', permissions: ['admin', 'create_query'] },
  client_config: { pageSize: 50 },
  messages: ['a notice'],
  org_name: 'Veodyn',
  org_slug: 'default',
}

/** The store as it is at module load, before anything has decided anything. */
function resetStore() {
  useAuthStore.setState({
    currentUser: null,
    isAuthenticated: false,
    isLoading: true,
    orgName: null,
    orgSlug: null,
    messages: [],
  })
}

beforeEach(resetStore)

describe('hydrateSession', () => {
  it('seeds the identity the server read, so nothing has to wait for a fetch', () => {
    hydrateSession({ status: 'authenticated', payload: PAYLOAD, needsApiKeyHeal: false })

    const state = useAuthStore.getState()
    // isLoading false is the whole point: SessionProvider gates on it, so this
    // is what stops the app rendering an interstitial and then a page.
    expect(state.isLoading).toBe(false)
    expect(state.isAuthenticated).toBe(true)
    expect(state.currentUser?.id).toBe(7)
    expect(state.currentUser?.isAdmin).toBe(true)
    expect(state.currentUser?.hasPermission('create_query')).toBe(true)
    expect(state.orgName).toBe('Veodyn')
    expect(state.messages).toEqual(['a notice'])
  })

  it('merges client_config over the defaults rather than replacing them', () => {
    hydrateSession({ status: 'authenticated', payload: PAYLOAD, needsApiKeyHeal: false })

    const config = useAuthStore.getState().clientConfig
    expect(config.pageSize).toBe(50)
    // A field Redash did not send has to keep its default, or every consumer of
    // the ones it omits reads undefined.
    expect(config.dateFormat).toBeTruthy()
  })

  it('settles an anonymous reader immediately, so the redirect is not delayed', () => {
    hydrateSession({ status: 'anonymous' })

    const state = useAuthStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.isAuthenticated).toBe(false)
    expect(state.currentUser).toBeNull()
  })

  it('leaves the store alone when the server declined to decide', () => {
    hydrateSession(null)

    // isLoading still true is what hands the question back to SessionProvider's
    // effect, which is the mock-mode path and the backend-unreachable path.
    // Settling it here would strand a demo visitor on the sign-in redirect.
    const state = useAuthStore.getState()
    expect(state.isLoading).toBe(true)
    expect(state.isAuthenticated).toBe(false)
  })
})
