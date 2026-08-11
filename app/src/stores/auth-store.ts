import { create } from 'zustand'
import { currentUser as mockCurrentUser, mockUsers } from '@/lib/mock-data'
import { USE_REAL_API } from '@/services/redash/config'
import {
  buildCurrentUser,
  buildMockCurrentUser,
  defaultClientConfig,
  readSignedOut,
  setMockSession,
  writeSignedOut,
  type ClientConfig,
  type CurrentUser,
  type InitialSession,
} from '@/stores/auth-identity'

// The identity shapes live next door; re-exported because every consumer in the
// app imports them from the store.
export type {
  ClientConfig,
  CurrentUser,
  InitialSession,
  Permission,
} from '@/stores/auth-identity'

// ─── Store ──────────────────────────────────────────────────────────────────
interface AuthState {
  currentUser: CurrentUser | null
  isAuthenticated: boolean
  isLoading: boolean
  clientConfig: ClientConfig
  /**
   * The Redash organization this session belongs to. Reported by GET
   * /api/session and kept because it is the only place the frontend can learn
   * the name of the instance it is pointed at: the organization-settings
   * contract does not carry it, and there is no endpoint that writes it.
   * Null in mock mode and until a session loads.
   */
  orgName: string | null
  orgSlug: string | null
  messages: string[]
  useRealApi: boolean
  /**
   * Why the last sign-in attempt failed, in the words of whoever refused it.
   * Null while no attempt has failed.
   *
   * /api/auth/login already tells apart a wrong password (401) from a backend
   * that is unreachable (502), unconfigured (503), or mid-setup (403). login()
   * used to answer a bare `false` for all of them, so the screen said "check
   * your credentials" while Redash was down and sent people to reset a password
   * that worked fine.
   */
  loginError: string | null

  loadSession: () => Promise<void>
  requireSession: () => Promise<boolean>
  login: (email: string, password?: string) => Promise<boolean>
  logout: () => Promise<boolean>
  setApiKey: () => void
}

/** The route's own message, or a fallback that at least names the status. */
async function refusalMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null)
  const message = (body as { message?: unknown } | null)?.message
  if (typeof message === 'string' && message.trim()) return message
  return `Sign in failed (${response.status}).`
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  isAuthenticated: false,
  isLoading: true,
  clientConfig: defaultClientConfig,
  orgName: null,
  orgSlug: null,
  messages: [],
  useRealApi: USE_REAL_API,
  loginError: null,

  // ─── loadSession ────────────────────────────────────────────────────
  // Mirrors Auth.loadSession() — calls GET /api/session on real backend,
  // or returns mock data.
  loadSession: async () => {
    if (USE_REAL_API) {
      // ── Real Redash backend ──
      try {
        const response = await fetch('/api/auth/session', { credentials: 'include' })
        if (!response.ok) throw new Error(`Session check failed (${response.status})`)
        const data = (await response.json()) as {
          user: Record<string, unknown>
          client_config: Partial<ClientConfig>
          messages: string[]
          org_name?: string
          org_slug?: string
        }

        const cu = buildCurrentUser(data.user)
        set({
          currentUser: cu,
          isAuthenticated: true,
          isLoading: false,
          clientConfig: { ...defaultClientConfig, ...data.client_config },
          orgName: data.org_name ?? null,
          orgSlug: data.org_slug ?? null,
          messages: data.messages || [],
        })
      } catch (err) {
        // Not authenticated — session cookie missing or expired
        console.warn('Session load failed:', err)
        set({ currentUser: null, isAuthenticated: false, isLoading: false })
      }
    } else {
      // ── Mock mode ──
      // A signed-out visitor stays signed out. Without this the demo handed
      // the admin identity straight back on the next navigation, so Sign Out
      // looked like it worked and then silently did not.
      if (readSignedOut()) {
        setMockSession(false)
        set({ currentUser: null, isAuthenticated: false, isLoading: false })
        return
      }
      await new Promise((r) => setTimeout(r, 100))
      const cu = buildMockCurrentUser(mockCurrentUser)
      setMockSession(true)
      set({
        currentUser: cu,
        isAuthenticated: true,
        isLoading: false,
        messages: [],
      })
    }
  },

  // ─── requireSession ─────────────────────────────────────────────────
  // Mirrors Auth.requireSession() — loads session if not loaded,
  // returns false if not authenticated (caller should show login).
  requireSession: async () => {
    const state = get()
    if (state.isAuthenticated && state.currentUser) return true
    await get().loadSession()
    return get().isAuthenticated
  },

  // ─── login ──────────────────────────────────────────────────────────
  // Real mode: /api/auth/login performs Redash's form-login dance
  // server-side and sets the session cookie on our origin.
  // Mock mode: find user by email in mock data. Also how the mock identity
  // switcher changes who you are, so that four-eyes governance can actually be
  // walked in a demo with only one browser.
  //
  // Answers whether the caller is now signed in. When it answers no, it leaves
  // `loginError` saying why, because the caller cannot see the response and
  // guessing on its behalf is how a backend outage got reported as a typo.
  login: async (email: string, password?: string) => {
    set({ loginError: null })

    if (USE_REAL_API) {
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        })
        if (!response.ok) {
          set({ loginError: await refusalMessage(response) })
          return false
        }
        await get().loadSession()
        if (!get().isAuthenticated) {
          // The credentials were accepted and the session check behind them
          // was not. Saying "check your credentials" here would point at the
          // one thing already known to be fine.
          set({ loginError: 'Signed in, but the session could not be loaded. Please try again.' })
          return false
        }
        return true
      } catch (err) {
        console.error('Login request failed:', err)
        set({ loginError: 'Could not reach the sign-in service. Check your connection.' })
        return false
      }
    } else {
      const user = mockUsers.find((u) => u.email === email)
      if (!user || user.is_disabled) {
        set({ loginError: 'No account with that email in the mock data.' })
        return false
      }
      const cu = buildMockCurrentUser(user)
      writeSignedOut(false)
      setMockSession(true)
      set({ currentUser: cu, isAuthenticated: true, isLoading: false })
      return true
    }
  },

  // ─── logout ─────────────────────────────────────────────────────────
  // Answers whether the session is actually gone.
  //
  // This used to fire the request and drop the client state regardless. The
  // `session` cookie is httpOnly, so only that response can clear it: when the
  // request failed the cookie survived, the middleware kept honouring it, and
  // the next reload signed the user straight back in. Sign Out looked like it
  // worked and had done nothing.
  logout: async () => {
    if (USE_REAL_API) {
      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        })
        if (!response.ok) return false
      } catch {
        return false
      }
    } else {
      writeSignedOut(true)
      setMockSession(false)
    }
    // Cleared with the session: whatever went wrong last time someone signed in
    // is not news for whoever reaches the card next.
    set({ currentUser: null, isAuthenticated: false, isLoading: false, loginError: null })
    return true
  },

  // ─── setApiKey ──────────────────────────────────────────────────────
  // For embed/public access — API key gives view_query only
  setApiKey: () => {
    if (USE_REAL_API) {
      // The API key is already handled by the api-client
      return
    }
    const cu = buildMockCurrentUser(mockCurrentUser)
    // Override permissions to view-only (mirrors Redash API user behavior)
    const viewOnly = buildCurrentUser({
      ...cu,
      permissions: ['view_query'],
    })
    set({ currentUser: viewOnly, isAuthenticated: true, isLoading: false })
  },
}))

/**
 * Seed the store from the session the SERVER already read, so the first paint
 * is the app rather than the words "Loading session...".
 *
 * Called during the first render of Providers, above every subscriber, and
 * exactly once per mount: there is no listener yet at that point, so this is a
 * plain assignment rather than an update to a rendering component.
 *
 * `null` leaves the store alone, which leaves `isLoading` true and hands the
 * question to SessionProvider's effect. That is the mock-mode path and the
 * backend-unreachable path, both of which the client already handles.
 */
export function hydrateSession(initial: InitialSession): void {
  if (initial === null) return

  if (initial.status === 'anonymous') {
    useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
    return
  }

  const { payload } = initial
  try {
    useAuthStore.setState({
      currentUser: buildCurrentUser(payload.user),
      isAuthenticated: true,
      isLoading: false,
      clientConfig: { ...defaultClientConfig, ...payload.client_config },
      orgName: payload.org_name ?? null,
      orgSlug: payload.org_slug ?? null,
      messages: payload.messages || [],
    })
  } catch (err) {
    // readServerSession checks `user.id` and casts the rest, so a Redash
    // payload whose shape is not what the cast claims reaches buildCurrentUser
    // intact. On the old client path that threw inside loadSession's try/catch
    // and settled as signed-out. Here it would throw during the ROOT render,
    // which is a 500 for the whole app rather than a degraded page, so it is
    // refused and the client decides exactly as if the server had declined.
    console.warn('Discarding an unusable server session payload:', err)
  }
}
