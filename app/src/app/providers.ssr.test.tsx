/**
 * What the SERVER renders for a request whose session was already read.
 *
 * zustand 5 answers `useStore` on the server from `api.getInitialState()` (see
 * node_modules/zustand/react.js), and `hydrateSession` calls `setState`, so the
 * server snapshot cannot see it: the interstitial is in the HTML and is
 * replaced when hydration commits, with no network in between.
 *
 * Seeding the initial state instead would be a security bug: the store module
 * is shared across requests in the Next server runtime, so one reader's
 * identity would become the next reader's initial state.
 *
 * Painting the app server-side needs SessionProvider to gate on the prop rather
 * than the store, and a pass over all 56 routes for a null currentUser.
 */
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// SessionProvider calls useRouter for its redirect, and no app router is
// mounted on the server.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/',
}))

import { Providers } from './providers'
import { SessionProvider } from '@/components/auth/session-provider'
import { useAuthStore } from '@/stores/auth-store'
import type { SessionPayload } from '@/stores/auth-identity'
import { defaultClientConfig } from '@/stores/auth-identity'
import type { ClientConfig } from '@/lib/config-schema'
import type { TelemetryClientConfig } from '@/lib/observability/telemetryConfig'

const telemetryOff: TelemetryClientConfig = {
  key: '',
  host: '',
  release: '',
  commit: '',
  org: '',
  disabled: true,
  consoleForwarding: false,
}

const PAYLOAD: SessionPayload = {
  user: { id: 7, name: 'Ada', email: 'ada@example.test', permissions: ['create_query'] },
  client_config: {},
  messages: [],
}

afterEach(() => {
  // clientConfig included, so the refusal case below can assert the store was
  // left untouched by identity rather than merely by content.
  useAuthStore.setState({
    currentUser: null,
    isAuthenticated: false,
    isLoading: true,
    clientConfig: defaultClientConfig,
  })
})

function ssr(initialSession: Parameters<typeof Providers>[0]['initialSession']) {
  return renderToString(
    <Providers
      config={{} as ClientConfig}
      telemetry={telemetryOff}
      initialSession={initialSession}
    >
      <SessionProvider>
        <p>the app</p>
      </SessionProvider>
    </Providers>
  )
}

describe('server rendering with a session the server already read', () => {
  it('hydrates the store, so nothing asks the network for the session', () => {
    ssr({ status: 'authenticated', payload: PAYLOAD, needsApiKeyHeal: false })

    // By the time the client runs the identity is in the store, so
    // SessionProvider's effect has nothing to fetch.
    const state = useAuthStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.isAuthenticated).toBe(true)
    expect(state.currentUser?.id).toBe(7)
  })

  it('still emits the interstitial rather than the app, because of the zustand server snapshot', () => {
    const html = ssr({ status: 'authenticated', payload: PAYLOAD, needsApiKeyHeal: false })

    // A limitation, not a desirable outcome: if this ever contains "the app",
    // the SSR gate described at the top of this file has been done and this
    // expectation should flip with it.
    expect(html).toContain('Loading session')
    expect(html).not.toContain('the app')
  })

  it('survives a Redash payload whose user shape is not what the cast claims', () => {
    // readServerSession checks user.id and casts the rest, and buildCurrentUser
    // reads permissions as an array. A throw here happens during the root
    // render, which is a 500 rather than a degraded page, so hydrateSession has
    // to refuse instead.
    const bad = { user: { id: 7, permissions: {} }, client_config: {}, messages: [] }

    expect(() =>
      ssr({ status: 'authenticated', payload: bad as SessionPayload, needsApiKeyHeal: false })
    ).not.toThrow()
    // Refused, so the client is left to decide exactly as if the server had
    // declined: isLoading stays true and SessionProvider's effect runs.
    expect(useAuthStore.getState().isLoading).toBe(true)
    expect(useAuthStore.getState().clientConfig).toBe(defaultClientConfig)
  })
})
