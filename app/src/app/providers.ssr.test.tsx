/**
 * What the SERVER renders for a request whose session was already read.
 *
 * This file exists because of a claim that turned out to be half true. Reading
 * the session in the root layout removes a client round trip, and that part is
 * real: nothing waits on /api/auth/session any more. It does NOT make the
 * first PAINT the app, and the reason is worth pinning down rather than
 * rediscovering.
 *
 * zustand 5 answers `useStore` on the server from `api.getInitialState()`
 * (see node_modules/zustand/react.js), which is the state captured when the
 * store was created. `hydrateSession` calls `setState`, so the server snapshot
 * cannot see it, and React deliberately uses that same server snapshot for the
 * hydration render so the two agree. The interstitial is therefore in the HTML
 * and is replaced when hydration commits, with no network in between.
 *
 * Seeding the initial state instead would be a security bug, not a fix: the
 * store module is shared across requests in the Next server runtime, so one
 * reader's identity would become the next reader's initial state.
 *
 * Making the server paint the app needs SessionProvider to gate on the prop
 * rather than on the store, which also means every page renders server-side
 * with a null currentUser for the first time. That is a bigger change than it
 * looks and wants its own pass over all 56 routes.
 */
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// SessionProvider calls useRouter for its redirect. On the server there is no
// app router mounted, and the redirect is not what any of this is about.
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

    // The point of the whole change: by the time the client runs, the identity
    // is in the store, so SessionProvider's effect has nothing to fetch.
    const state = useAuthStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.isAuthenticated).toBe(true)
    expect(state.currentUser?.id).toBe(7)
  })

  it('still emits the interstitial rather than the app, because of the zustand server snapshot', () => {
    const html = ssr({ status: 'authenticated', payload: PAYLOAD, needsApiKeyHeal: false })

    // Documenting a limitation, not asserting a desirable outcome. If this flips
    // to containing "the app", the SSR gate described at the top of this file
    // has been done and this expectation should flip with it.
    expect(html).toContain('Loading session')
    expect(html).not.toContain('the app')
  })

  it('survives a Redash payload whose user shape is not what the cast claims', () => {
    // readServerSession checks user.id and casts the rest. buildCurrentUser
    // then reads permissions as an array. On the old client path a bad payload
    // threw inside loadSession's try/catch and signed the reader out; here it
    // would throw during the root render, which is a 500 instead of a
    // degraded page, so hydrateSession has to refuse rather than throw.
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
