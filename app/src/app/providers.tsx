'use client'

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ConfigProvider } from '@/components/config/config-provider'
import { isAppError } from '@/lib/errorIds'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IdentifyUser } from '@/lib/observability/IdentifyUser'
import { reportQueryError } from '@/lib/observability/querySeam'
import { TelemetryProvider } from '@/lib/observability/TelemetryProvider'
import type { TelemetryClientConfig } from '@/lib/observability/telemetryConfig'
import { hydrateSession, useAuthStore, type InitialSession } from '@/stores/auth-store'
import type { ClientConfig } from '@/lib/config-schema'
// Installs the instance's plugins into the BROWSER graph, so it has to run from
// a client component: the root layout is a server component, and registering
// there leaves the registry the browser hydrates against empty.
import '@/plugins'

// 4xx are settled facts and are not retried. 408 and 429 are the two that are
// worth another attempt: a timeout and a rate limit both mean "not now".
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429])

// Only an AppError carries a status: the service clients attach it as context
// (see errorIds.ts). Anything else keeps the default three attempts.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = isAppError(error) ? error.context.status : undefined
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return RETRYABLE_CLIENT_STATUSES.has(status) && failureCount < 3
  }
  return failureCount < 3
}

/**
 * The two caches whose entries are QUERY EXECUTIONS rather than reads: a
 * refetch-on-focus miss here runs `POST queries/:id/results` against Redash,
 * once per widget on the dashboard. The explicit path to fresh numbers is the
 * per-widget refresh, which forces `max_age: 0`.
 */
const EXECUTION_QUERY_KEYS = [['widget-data'], ['query-result']] as const

function createQueryClient() {
  const client = new QueryClient({
    // The cache is the only place a query failure is visible: a consumer that
    // destructures `{ data, isLoading }` renders a failed fetch as empty.
    queryCache: new QueryCache({
      onError: (error, query) => reportQueryError(error, query.queryKey),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        reportQueryError(error, mutation.options.mutationKey ?? []),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
      },
    },
  })

  for (const key of EXECUTION_QUERY_KEYS) {
    client.setQueryDefaults(key, { refetchOnWindowFocus: false })
  }

  return client
}

/**
 * Holds one query cache, for one identity. Remounted by its key below, which is
 * how the cache is retired: a fresh mount builds a fresh client, and the
 * unmount cleanup cancels and clears the outgoing one.
 */
function IdentityScopedQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  useEffect(() => {
    // Cancel before clearing so a request still in flight for the retiring
    // identity cannot resolve into anything.
    return () => {
      void queryClient.cancelQueries()
      queryClient.clear()
    }
  }, [queryClient])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/**
 * A number that changes whenever a session is LEFT, and not when one is entered.
 *
 * Query keys name WHAT they hold ('queries', ['kpi', id]) and never who asked,
 * so with a 30s staleTime the next person to sign in could be handed the
 * previous person's rows with no refetch. Keying the subtree on this discards
 * the cache, and the component state underneath it, on sign-out.
 *
 * Signing in from anonymous must NOT bump it: the tree destroyed at that moment
 * is the sign-in card mid-handover to the router, which came back with
 * `loading` reset and re-armed its button after the sign-in had already worked.
 */
function useIdentityEpoch(userId: number | null): number {
  const [seen, setSeen] = useState({ userId, epoch: 0 })
  if (seen.userId !== userId) {
    // Adjusting state during render: React re-runs this component immediately
    // and discards the first pass, so the key never lags the identity by a
    // commit.
    setSeen({ userId, epoch: seen.userId === null ? seen.epoch : seen.epoch + 1 })
  }
  return seen.epoch
}

export function Providers({
  config,
  telemetry,
  initialSession,
  children,
}: {
  config: ClientConfig
  telemetry: TelemetryClientConfig
  initialSession: InitialSession
  children: React.ReactNode
}) {
  // FIRST, above every subscriber in the tree and above this component's own
  // read below. A useState initialiser runs once during the first render, while
  // nothing is listening to the store yet, so this is a plain assignment rather
  // than an update to a component that is already rendering.
  useState(() => hydrateSession(initialSession))

  const userId = useAuthStore((s) => s.currentUser?.id ?? null)
  const cacheEpoch = useIdentityEpoch(userId)

  // GET /api/auth/session re-mints the `redash_api_key` cookie for a session
  // that has lost it, and a server component cannot set a cookie. Fired here
  // only for a session that actually lacks the cookie.
  //
  // KNOWN RACE, inherited: that route forwards Redash's refreshed `session`
  // cookie, so a sign-out completing while this request is in flight can be
  // undone by the response landing afterwards. Closing it means changing that
  // route, not this call.
  const needsApiKeyHeal = initialSession?.status === 'authenticated' && initialSession.needsApiKeyHeal
  useEffect(() => {
    if (!needsApiKeyHeal) return
    void fetch('/api/auth/session', { credentials: 'include' }).catch(() => {})
  }, [needsApiKeyHeal])

  return (
    <ConfigProvider value={config}>
      {/* Outside the identity-scoped provider below, which is remounted on
          every sign-out: re-initialising PostHog there would tear down and
          restart the session recording each time. */}
      <TelemetryProvider config={telemetry}>
        <IdentifyUser />
        <IdentityScopedQueryProvider key={cacheEpoch}>
          {/* One provider for the whole app, so icon buttons across a toolbar
              share a hover delay rather than each imposing a fresh one. */}
          <TooltipProvider>{children}</TooltipProvider>
        </IdentityScopedQueryProvider>
      </TelemetryProvider>
    </ConfigProvider>
  )
}
