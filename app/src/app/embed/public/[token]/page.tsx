'use client'

// The one unauthenticated visualization route. It resolves an unlisted share
// token to a single visualization and its latest result, so it needs no session
// and runs no query: a revoked token, an expired one, a token that was never
// issued, and an outage upstream all end on the same "no longer available"
// panel rather than an error boundary or a sign-in redirect.
//
// Reached by /embed in middleware.ts PUBLIC_ROUTES. That entry is matched on a
// segment boundary (`pathname === '/embed' || startsWith('/embed/')`), so
// /embed/public/<token> is already covered and a second entry would only be a
// second thing to keep in sync.
//
// The page fills the viewport. Its audience is a webview on a wall screen as
// much as an iframe in a document, and the host iframe or webview is the
// sizing surface either way. Charts size themselves to exactly that surface;
// a TABLE sizes to its rows instead, so the wrapper scrolls rather than clips
// (see the wrapper below for what clipping cost).
import { use } from 'react'
import type { CSSProperties } from 'react'
import { Link2Off } from 'lucide-react'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'
import { CHART_FILL_VAR } from '@/components/visualizations/chart/chart-frame'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { usePublicVisualization } from '@/hooks/use-visualizations'
import { visualizationData } from '@/lib/visualizations'
import { PUBLIC_VISUALIZATION_ID } from '@/lib/public-visualization'

// The bounds on `?refresh=`, in seconds. The floor keeps a mistyped `1` from
// hammering the backend once per second from every screen in a lobby; the
// ceiling exists only because a cadence past an hour is indistinguishable from
// a stale page, and clamping beats ignoring.
const MIN_REFRESH_SECONDS = 15
const MAX_REFRESH_SECONDS = 3600

/**
 * The refetch cadence a link asked for, in milliseconds, or null for a link
 * that did not ask. Absent and unreadable both mean null: a link minted before
 * the parameter existed keeps behaving the way it always did, fetch once.
 */
function refreshIntervalMs(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value
  if (!text) return null
  const seconds = Number(text)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.min(Math.max(Math.round(seconds), MIN_REFRESH_SECONDS), MAX_REFRESH_SECONDS) * 1000
}

function Unavailable() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader className="justify-items-center text-center">
          <Link2Off className="size-8 text-muted-foreground" aria-hidden="true" />
          <CardTitle>
            {/* The only heading on the page: there is no visualization to name. */}
            <h1 className="font-display text-2xl font-medium tracking-tight">
              This visualization is no longer available.
            </h1>
          </CardTitle>
          <CardDescription>The link may have been revoked.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

export default function PublicEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = use(params)
  const refresh = refreshIntervalMs(use(searchParams).refresh)
  // The token is a lookup key and is never rendered, so a screenshot of the
  // dead-link panel cannot hand a working token back out.
  const {
    data: payload,
    isLoading,
    isError,
  } = usePublicVisualization(token, { refetchIntervalMs: refresh })

  if (isLoading) {
    return (
      <div className="p-4">
        <h1 className="sr-only">Loading this visualization</h1>
        <SkeletonCard lines={4} />
      </div>
    )
  }

  // One branch for every refusal: unknown token, revoked, expired, a backend
  // that is not configured, and a request that failed outright.
  if (isError || !payload) return <Unavailable />

  // A payload can arrive without a result: the owning query has never run.
  // Whether that is fatal is the type's call, not this page's. A `needs:
  // 'none'` plugin (a wall image panel) draws from EMPTY_QUERY_RESULT; a chart
  // is a dead link, exactly as it was when the route answered 404 for it.
  const data = visualizationData(payload.visualization.type, payload.data)
  if (!data) return <Unavailable />

  return (
    <div
      // overflow-auto, not hidden: a chart fills exactly 100dvh and never
      // scrolls, but QueryResultTable sizes to its rows, and with the document
      // scrollbar removed a public TABLE taller than the viewport clipped its
      // lower rows and its pagination with no way to reach them.
      className="h-dvh w-full overflow-auto bg-background"
      // Charts size themselves from this variable (see chart-frame.tsx); on a
      // page that is nothing but the visualization, the room they have is the
      // viewport itself.
      style={{ [CHART_FILL_VAR]: '100dvh' } as CSSProperties}
    >
      <h1 className="sr-only">{payload.visualization.name || 'Shared visualization'}</h1>
      <VisualizationRenderer
        // The id and the timestamps are not part of the public contract: Redash
        // sends none of them, a reader has no use for when the chart was
        // configured, and the renderer reads neither. A local stand-in and empty
        // strings, rather than values invented to fill the type.
        visualization={{
          ...payload.visualization,
          id: PUBLIC_VISUALIZATION_ID,
          created_at: '',
          updated_at: '',
        }}
        data={data}
      />
    </div>
  )
}
