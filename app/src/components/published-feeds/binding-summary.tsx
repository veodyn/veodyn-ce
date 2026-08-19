import { Card, CardContent } from '@/components/ui/card'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { PublishedFeed } from '@/types/published-feed'

// What the feed is bound to, read from the write-response shape and not from
// anything the validator decided. `bindingState` is deliberately absent: it is
// only fresh in a write response, both read paths hard-code it to `unknown`,
// and rendering it here would claim a mapping check that never ran.
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="font-mono text-sm text-muted-foreground">{value}</dd>
    </div>
  )
}

export function BindingSummary({ feed }: { feed: PublishedFeed }) {
  const onErrorLabel =
    feed.onError === 'last_good'
      ? `last known good${feed.lastGoodMaxAgeSeconds != null ? `, up to ${feed.lastGoodMaxAgeSeconds}s old` : ''}`
      : 'block on a bad read'

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className={SUBSECTION_HEADING}>Binding</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Detail label="Query" value={String(feed.queryId)} />
          <Detail label="Standard" value={`${feed.standard} ${feed.version}`} />
          <Detail label="Entity" value={feed.entity} />
          {/* Each standard carries one of these and never the other, so the row
              is absent rather than blank on the standard it does not apply to. */}
          {feed.staticGtfsRef !== null && (
            <Detail label="Static GTFS reference" value={feed.staticGtfsRef} />
          )}
          <Detail label="On error" value={onErrorLabel} />
          <Detail label="Visibility" value={feed.visibility} />
          <Detail label="Revision" value={String(feed.revision)} />
        </dl>
        {feed.systemInfo && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">System</h3>
            <dl className="space-y-0.5">
              {Object.entries(feed.systemInfo).map(([field, value]) => (
                <div key={field} className="flex gap-2 font-mono text-xs text-muted-foreground">
                  <dt>{field}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Column map</h3>
          <dl className="space-y-0.5">
            {Object.entries(feed.columnMap).map(([field, column]) => (
              <div key={field} className="flex gap-2 font-mono text-xs text-muted-foreground">
                <dt>{field}</dt>
                <dd>{column}</dd>
              </div>
            ))}
          </dl>
        </div>
      </CardContent>
    </Card>
  )
}
