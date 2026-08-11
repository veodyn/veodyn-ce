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
// Installs the instance's plugins into the BROWSER graph, which is why this
// sits in a client component and not in the root layout: the root layout is a
// server component, so registering there would populate the registry that
// renders the HTML and leave the one the browser hydrates against empty. Every
// page mounts these providers, so this is the client entry.
import '@/plugins'

// TanStack's default is three retries for every failure, which is right for a
// network blip and wrong for an answer the backend will keep giving. A missing
// route (404) and a rejected credential (401/403) are settled facts: retrying
// them costs four requests and several seconds of skeleton before the page can
// say anything, which is how /feed-health held a loading state while
// /api/feeds answered 404 four times in a row.
//
// 408 and 429 are the two 4xx that ARE worth another attempt: a timeout and a
// rate limit both mean "not now" rather than "not ever".
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429])

// Only an AppError carries a status: the service clients attach it as context
// (see errorIds.ts). Anything else is a network failure or a parse error with
// no verdict attached, and those keep the default three attempts.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = isAppError(error) ? error.context.status : undefined
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return RETRYABLE_CLIENT_STATUSES.has(status) && failureCount < 3
  }
  return failureCount < 3
}

/**
 * The two caches whose entries are QUERY EXECUTIONS rather than reads.
 *
 * Refetch-on-focus is close to free for a list of dashboards. It is not free
 * for these: every widget on a dashboard holds its own `widget-data` entry, and
 * a miss on one runs `POST queries/:id/results` against Redash. Alt-tab back to
 * a twenty-widget dashboard after the 30s staleTime and that was twenty query
 * executions, triggered by nothing the reader did, on a backend where a single
 * query can be seconds of warehouse time.
 *
 * The explicit way to get fresh numbers is the per-widget refresh, which forces
 * `max_age: 0` and is the only path that actually re-executes. The dashboard's
 * Refresh button is weaker than it looks and is NOT the justification here: it
 * only invalidates these keys, and use-widget-data's tier 1 then hands back the
 * `latest_query_data` embedded in the dashboard payload, so the refetch can
 * return the same rows without touching Redash. Worth fixing on its own; it is
 * not made worse by this.
 *
 * What this changes is only the unasked-for case. Returning to a tab is not a
 * request for fresh numbers.
 */
const EXECUTION_QUERY_KEYS = [['widget-data'], ['query-result']] as const

function createQueryClient() {
  const client = new QueryClient({
    // The telemetry seam that matters most. A consumer that destructures
    // `{ data, isLoading }` and never checks `isError` renders a failed fetch as
    // an empty state: no toast, no throw, and an autocaptured click that looks
    // like it worked. The cache is the only place that failure is visible.
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
 * A number that changes whenever a session is LEFT, and deliberately not when
 * one is entered.
 *
 * Server state belongs to an identity, and Providers outlives a sign-out. Every
 * list and detail query is keyed by WHAT it is ('queries', ['kpi', id]) and
 * never by who asked, so with a 30s staleTime the next person to sign in could
 * be handed the previous person's rows with no refetch: their queries,
 * dashboards, reports, users and settings. The identity switcher turned that
 * from theoretical into a two-click path. Keying the subtree on this is what
 * discards it, and remounting drops the component state underneath too, which
 * is the same answer: a half-filled form belongs to whoever was typing in it,
 * not to whoever signs in next.
 *
 * Signing in from anonymous is the one transition that must NOT bump it. There
 * is nothing to leave behind on the way in, and the tree destroyed at that
 * exact moment is the sign-in card, mid-handover to the router: it came back a
 * fresh instance with `loading` reset, so the button re-armed itself and read
 * "Sign In" seconds after the sign-in had already worked. People took that for
 * a dead click and clicked again. Signing out still bumps it, so the client the
 * next person inherits was built after the last one was cleared.
 */
function useIdentityEpoch(userId: number | null): number {
  const [seen, setSeen] = useState({ userId, epoch: 0 })
  if (seen.userId !== userId) {
    // Adjusting state during render: React re-runs this component immediately
    // and discards the first pass, so the key never lags the identity by a
    // commit. Doing it in an effect would render one frame against the cache
    // that is on its way out.
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
  // read below. A useState initialiser runs once, during the first render,
  // while nothing is listening to the store yet, so this is a plain assignment
  // rather than an update to a component that is already rendering. By the time
  // the selector on the next line runs, the identity is already in place and
  // SessionProvider has nothing to wait for.
  useState(() => hydrateSession(initialSession))

  const userId = useAuthStore((s) => s.currentUser?.id ?? null)
  const cacheEpoch = useIdentityEpoch(userId)

  // The one thing the server read could not do. GET /api/auth/session re-mints
  // the `redash_api_key` cookie for a session that has lost it, and a server
  // component cannot set a cookie, so the route is fired here instead: once,
  // in the background, with nothing waiting on it. Only for a session that
  // actually lacks the cookie, which is the rare repair case rather than the
  // ordinary load.
  //
  // KNOWN RACE, inherited rather than introduced: that route forwards Redash's
  // refreshed `session` cookie, so a sign-out that completes while this request
  // is in flight can be undone by the response landing afterwards. The old
  // unconditional loadSession-on-mount hit the same window on EVERY load; this
  // narrows it to sessions missing the api-key cookie. Closing it properly means
  // the route not refreshing cookies on a request it did not have to make, which
  // is a change to that route rather than to this call.
  const needsApiKeyHeal = initialSession?.status === 'authenticated' && initialSession.needsApiKeyHeal
  useEffect(() => {
    if (!needsApiKeyHeal) return
    void fetch('/api/auth/session', { credentials: 'include' }).catch(() => {})
  }, [needsApiKeyHeal])

  return (
    <ConfigProvider value={config}>
      {/* Outside the identity-scoped provider below, which is remounted by its
          key on every sign-out. Re-initialising PostHog there would tear down
          and restart the session recording each time somebody signed out. */}
      <TelemetryProvider config={telemetry}>
        <IdentifyUser />
        <IdentityScopedQueryProvider key={cacheEpoch}>
          {/* One provider for the whole app, so the icon buttons scattered across
              it share a hover delay and a person crossing a toolbar reads a row
              of labels rather than waiting out a fresh delay per button. */}
          <TooltipProvider>{children}</TooltipProvider>
        </IdentityScopedQueryProvider>
      </TelemetryProvider>
    </ConfigProvider>
  )
}
