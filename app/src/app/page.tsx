'use client'

import Link from 'next/link'
import { BarChart3, LayoutDashboard, Star } from 'lucide-react'
import { useFavoriteQueries, useRecentQueries } from '@/hooks/use-queries'
import { useFavoriteDashboards } from '@/hooks/use-dashboards'
import { TimeAgo } from '@/components/shared/time-ago'
import { useConfig } from '@/components/config/config-provider'
import { AssistantWidget } from '@/components/home/assistant-widget'
import { Slot } from '@/features/slots'
import { HomeOmnisearch } from '@/components/home/home-omnisearch'
import { NotableChangesStrip } from '@/components/home/notable-changes-strip'
import { evenGridColumns } from '@/lib/grid-columns'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { SECTION_HEADING } from '@/lib/section-heading'

/**
 * A list-shaped placeholder, sized to the card the list will become.
 *
 * Home read `data` only, so while the three lists were in flight every section
 * below the search box was simply absent: the front door rendered a title over
 * empty space and then popped three cards in underneath it. An absent section
 * is also what an EMPTY list looks like here, which is the point of keeping the
 * two apart. Not loading means "you have no favourites", and that answer stays
 * silent; not settled means "we do not know yet", and that gets this.
 */
function HomeListSkeleton({ rows }: { rows: number }) {
  return (
    // aria-hidden, with the status role on the ONE wrapper below rather than
    // here. Three of these mount together on a first load, and three separate
    // status regions announcing at once is a burst that says less than one
    // sentence does.
    <div aria-hidden="true" className="motion-safe:animate-pulse">
      <div className={`mb-2 h-3 w-32 rounded bg-muted ${SECTION_HEADING}`} />
      <div className="divide-y rounded-lg border bg-card">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5">
            <div className="h-3.5 w-48 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function HomePage() {
  const { brand, home } = useConfig()
  const favoriteQueriesQuery = useFavoriteQueries()
  const favoriteDashboardsQuery = useFavoriteDashboards()
  const recentQueriesQuery = useRecentQueries()

  const favoriteQueries = favoriteQueriesQuery.data
  const favoriteDashboards = favoriteDashboardsQuery.data
  const recentQueries = recentQueriesQuery.data

  // The two favourite lists share one grid, so they wait together: showing one
  // real column beside one skeleton column would reflow the row the moment the
  // second landed. The recent list is its own section and settles on its own.
  const favoritesPending = favoriteQueriesQuery.isLoading || favoriteDashboardsQuery.isLoading

  const showFavoriteQueries = Boolean(favoriteQueries && favoriteQueries.results.length > 0)
  const showFavoriteDashboards = Boolean(favoriteDashboards && favoriteDashboards.results.length > 0)
  const favoriteCount = [showFavoriteQueries, showFavoriteDashboards].filter(Boolean).length

  return (
    <PageContainer>
      {/* The same PageHeader every other route uses. Home hand-rolled its own
          title block at text-4xl inside a `header.mb-8`, so the first page you
          land on set a type scale and a header gap that nothing you navigate to
          afterwards repeated: every other page titles at text-2xl above a mb-6.
          Being the front door is not a reason to be the exception. */}
      <PageHeader title={`Welcome to ${brand.name}`} description={home.tagline} />

      {/* Omnisearch shell. Federation, results page, and command palette land in
          plan 03; here only the input plus its onSubmit seam. */}
      <div className="mb-10">
        <HomeOmnisearch />
      </div>

      <NotableChangesStrip />
      {/* The AI digest is an enterprise surface and Home is not, so it arrives
          through the registry. Nothing installed means nothing here: the
          community front door has no claims of its own to summarise, and the
          sections below close up the way they do when the digest has no items
          worth showing. */}
      <Slot id="home.aiDigest" props={{}} fallback={null} />

      {favoritesPending ? (
        // Two columns, which is what an instance with favourites shows and the
        // wider of the two layouts: guessing narrow and widening looks like the
        // page changed its mind.
        <div
          role="status"
          aria-label="Loading your favorites"
          className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-2"
        >
          <HomeListSkeleton rows={5} />
          <HomeListSkeleton rows={5} />
        </div>
      ) : favoriteCount > 0 ? (
        <div className={`mb-10 grid grid-cols-1 gap-6 ${evenGridColumns(favoriteCount)}`}>
          {showFavoriteQueries && favoriteQueries && (
            <section>
              <h2 className={`mb-2 flex items-center gap-2 ${SECTION_HEADING}`}>
                <Star className="h-3.5 w-3.5 text-muted-foreground" />
                Favorite Queries
              </h2>
              <div className="divide-y rounded-lg border bg-card">
                {favoriteQueries.results.slice(0, 5).map((q) => (
                  <Link
                    key={q.id}
                    href={`/queries/${q.id}`}
                    className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{q.name}</span>
                    </div>
                    {/* tabular-nums: aligned/scanned numeric text stays tabular
                        even though this is a relative-time string, not a raw
                        number (Global Constraints, tabular figures). */}
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      <TimeAgo date={q.updated_at} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {showFavoriteDashboards && favoriteDashboards && (
            <section>
              <h2 className={`mb-2 flex items-center gap-2 ${SECTION_HEADING}`}>
                <Star className="h-3.5 w-3.5 text-muted-foreground" />
                Favorite Dashboards
              </h2>
              <div className="divide-y rounded-lg border bg-card">
                {favoriteDashboards.results.slice(0, 5).map((d) => (
                  <Link
                    key={d.id}
                    href={`/dashboards/${d.id}`}
                    className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{d.name}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      <TimeAgo date={d.updated_at} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}

      {recentQueriesQuery.isLoading ? (
        <section role="status" aria-label="Loading recent queries" className="mb-10">
          <HomeListSkeleton rows={8} />
        </section>
      ) : recentQueries && recentQueries.results.length > 0 ? (
        <section className="mb-10">
          <h2 className={`mb-2 ${SECTION_HEADING}`}>Recent Queries</h2>
          <div className="divide-y rounded-lg border bg-card">
            {recentQueries.results.slice(0, 8).map((q) => (
              <Link
                key={q.id}
                href={`/queries/${q.id}`}
                className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-muted/50"
              >
                <div>
                  <span className="text-sm">{q.name}</span>
                  {q.user?.name && (
                    <span className="ml-2 text-xs text-muted-foreground">by {q.user.name}</span>
                  )}
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  <TimeAgo date={q.updated_at} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Assistant overlay stays as-is (config-driven; renders nothing when no
          assistant.widget_url). */}
      <AssistantWidget />
    </PageContainer>
  )
}
