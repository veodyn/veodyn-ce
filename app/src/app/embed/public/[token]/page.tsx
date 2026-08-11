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
import { use } from 'react'
import { Link2Off } from 'lucide-react'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { usePublicVisualization } from '@/hooks/use-visualizations'
import { PUBLIC_VISUALIZATION_ID } from '@/lib/public-visualization'

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

export default function PublicEmbedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  // The token is a lookup key and is never rendered, so a screenshot of the
  // dead-link panel cannot hand a working token back out.
  const { data: payload, isLoading, isError } = usePublicVisualization(token)

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

  return (
    <div className="min-h-screen bg-background">
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
        data={payload.data}
      />
    </div>
  )
}
