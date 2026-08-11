// Sign Out used to be undone by the next navigation: loadSession() ran again,
// saw mock mode, and handed the admin identity straight back. The control
// looked like it worked, and a walkthrough found the authenticated shell
// restored on the very next page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { mockUsers } from '@/lib/mock-data'

function resetStore() {
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: true })
}

describe('signing out of mock mode', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
  })

  it('signs a first-time visitor in, because that is what a demo is', async () => {
    await useAuthStore.getState().loadSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('holds the visitor signed out across a reload', async () => {
    await useAuthStore.getState().loadSession()
    expect(await useAuthStore.getState().logout()).toBe(true)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    // A reload is a fresh store plus another loadSession, which is exactly the
    // path that used to re-authenticate.
    resetStore()
    await useAuthStore.getState().loadSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().currentUser).toBeNull()
    expect(document.cookie).not.toContain('mock-demo-session')
  })

  it('signs back in when the user actually signs in', async () => {
    await useAuthStore.getState().loadSession()
    await useAuthStore.getState().logout()

    expect(await useAuthStore.getState().login('admin@example.com', 'mock')).toBe(true)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    // And the marker is gone, so the next reload does not sign them out again.
    resetStore()
    await useAuthStore.getState().loadSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})

describe('switching mock identity', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetStore()
  })

  it('becomes the chosen user, permissions and all', async () => {
    await useAuthStore.getState().loadSession()
    expect(useAuthStore.getState().currentUser?.name).toBe('Admin User')

    expect(await useAuthStore.getState().login('jane@example.com')).toBe(true)

    const jane = useAuthStore.getState().currentUser
    expect(jane?.name).toBe('Jane Analyst')
    expect(jane?.hasPermission('publish_report')).toBe(false)
  })

  it('offers a second identity that can approve, so four-eyes is satisfiable', () => {
    // Four-eyes needs two people who may publish. With only the admin, a report
    // could be submitted for review and then approved by nobody.
    const publishers = mockUsers.filter(
      (user) => !user.is_disabled && !user.is_invitation_pending && user.groups.includes(1)
    )
    expect(publishers.length).toBeGreaterThanOrEqual(2)
  })

  it('refuses an identity that is not a mock user', async () => {
    await useAuthStore.getState().loadSession()
    expect(await useAuthStore.getState().login('nobody@example.com')).toBe(false)
    expect(useAuthStore.getState().currentUser?.name).toBe('Admin User')
  })
})


// Only the server can clear the httpOnly `session` cookie. When that request
// failed, logout dropped the client state anyway and reported nothing, so the
// cookie survived, the middleware kept honouring it, and the next reload signed
// the user straight back in.
describe('signing out of a configured deployment', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function loadRealModeStore() {
    vi.resetModules()
    vi.doMock('@/services/redash/config', () => ({ USE_REAL_API: true }))
    return (await import('@/stores/auth-store')).useAuthStore
  }

  it('refuses to claim success when the server did not clear the cookie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }))
    const store = await loadRealModeStore()
    store.setState({ currentUser: { id: 1 } as never, isAuthenticated: true, isLoading: false })

    expect(await store.getState().logout()).toBe(false)
    // Still signed in, which is the truth: the session is still live.
    expect(store.getState().isAuthenticated).toBe(true)
  })

  it('refuses to claim success when the request never got there', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const store = await loadRealModeStore()
    store.setState({ currentUser: { id: 1 } as never, isAuthenticated: true, isLoading: false })

    expect(await store.getState().logout()).toBe(false)
    expect(store.getState().isAuthenticated).toBe(true)
  })

  it('signs out when the server confirms it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const store = await loadRealModeStore()
    store.setState({ currentUser: { id: 1 } as never, isAuthenticated: true, isLoading: false })

    expect(await store.getState().logout()).toBe(true)
    expect(store.getState().isAuthenticated).toBe(false)
    expect(store.getState().currentUser).toBeNull()
  })
})
