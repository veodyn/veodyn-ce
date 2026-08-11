import { PageContainer, type PageWidth } from '@/components/layout/page-container'

/**
 * What a route shows while its own segment, or its own data, is still on the way.
 *
 * The root layout is `force-dynamic`, so every navigation waits on a server
 * round-trip for the segment's RSC payload before anything of the new page can
 * render. Without a `loading.tsx` beside a page, React holds the OLD page on
 * screen for that whole wait, so clicking a sidebar link reads as a click that
 * did nothing. This is the boundary that turns that into an immediate response.
 *
 * Deliberately the page SHELL rather than a spinner: it renders inside the same
 * PageContainer the route will use, with a title-sized block where the title
 * goes, so the layout does not jump when the real page replaces it.
 *
 * `rows` is a rough height, not a layout: matching a route's exact furniture
 * would be a second copy of that route's markup, kept in step by hand, and it
 * would be wrong the first time the page changed.
 *
 * **This announces, and it did not used to.** The old reasoning was that Next's
 * route announcer already speaks on navigation, so a skeleton that also spoke
 * would announce twice. That is true of Next in general and false of this app:
 * the announcer reads `document.title` and only speaks when it CHANGES, and
 * layout.tsx's generateMetadata returns `config.brand.name` for every route
 * while no route under the authenticated shell overrides it. The title is the
 * same string on all 54 of them, so the announcer has nothing new to say on any
 * navigation and an aria-hidden skeleton left a screen reader with silence for
 * the whole wait. Give a route its own title one day and the two say different
 * things rather than the same thing twice, which is still the right outcome.
 *
 * `label` is therefore a specificity knob, not an on/off switch: pass one where
 * the page can say what it is waiting for.
 */
export function PageLoading({
  width = 'full',
  rows = 6,
  label = 'Loading',
}: {
  width?: PageWidth
  rows?: number
  label?: string
}) {
  return (
    <PageContainer width={width}>
      {/* The status role sits on the wrapper and the blocks below are decorative,
          so a reader hears the state once rather than walking a fence of empty
          divs. motion-safe so a reader who asked for less motion gets a still
          placeholder rather than a pulsing page. */}
      <div role="status" aria-label={label} className="motion-safe:animate-pulse">
        <div className="mb-6 flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-48 rounded bg-muted" />
            <div className="h-4 w-72 rounded bg-muted/60" />
          </div>
          <div className="h-9 w-28 rounded-md bg-muted" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-4 flex-1 rounded bg-muted" />
              <div className="h-4 w-24 rounded bg-muted/60" />
              <div className="h-4 w-16 rounded bg-muted/40" />
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
