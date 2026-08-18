import { PageContainer, type PageWidth } from '@/components/layout/page-container'

/**
 * What a route shows while its own segment, or its own data, is still on the way.
 *
 * The root layout is `force-dynamic`, so without a `loading.tsx` beside a page
 * React holds the OLD page on screen for the whole RSC round-trip and a sidebar
 * click reads as a click that did nothing.
 *
 * The page SHELL rather than a spinner, inside the same PageContainer the route
 * will use, so the layout does not jump. `rows` is a rough height, not a copy of
 * the route's furniture.
 *
 * This announces, and it has to: Next's route announcer reads `document.title`
 * and only speaks when it CHANGES, and layout.tsx's generateMetadata returns
 * `config.brand.name` for all 54 routes, so it never fires here. `label` is a
 * specificity knob, not an on/off switch.
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
      {/* The status role sits on the wrapper so a reader hears the state once
          rather than walking a fence of empty divs. motion-safe so a reduced
          motion preference gets a still placeholder. */}
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
