import Link from 'next/link'
import { PencilLine } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { TagsControl } from '@/components/shared/tags-control'
import { visibleTags } from '@/lib/tags'
import { FreshnessBadge } from './freshness-badge'
import type { Dataset } from '@/types/catalog'

export function DatasetCard({ dataset }: { dataset: Dataset }) {
  // `domain:*` tags drive the hub filter above and are never chips, which is
  // the same rule TagsControl applies everywhere else.
  const tags = visibleTags(dataset.tags)
  // A dataset people type into rather than one a scheduled query fills. A
  // community build never sets this (`DatasetOut.origin`'s own comment), so
  // the badge below is dead code here and live on a pack build, the same
  // arrangement `writable` and the dataset.records slot already have.
  const isContributed = dataset.origin === 'contributed'

  return (
    // The card is no longer one big anchor. It used to be, and a tag chip is a
    // link too: nesting those is invalid, and it is why the catalog was the one
    // browse surface in the product with no tags on it at all. A tag could be
    // saved on a dataset and then reached from nowhere a person would look, so
    // the chips are the way in and the title carries the navigation.
    <Card className="relative transition-colors hover:ring-primary/50">
      <CardHeader>
        <h3 className="font-display font-medium">
          {/* The overlay is what keeps the WHOLE card clickable, as it was
              before, while leaving the chips below it clickable in their own
              right: they are positioned, so they paint above it. */}
          <Link href={`/data/dataset/${dataset.id}`} className="after:absolute after:inset-0">
            {dataset.name}
          </Link>
        </h3>
        {/* The domain line always occupies a row. Collapsing it on a
            domain-less dataset lifts that card's freshness row above its
            neighbours' in the same grid row. The placeholder is hidden from
            assistive tech so no blank domain is announced. */}
        {dataset.domain ? (
          <span className="font-display text-xs text-muted-foreground">{dataset.domain}</span>
        ) : (
          <span aria-hidden="true" className="font-display text-xs">
            &nbsp;
          </span>
        )}
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        {/* Captures get freshness, contributed datasets get told apart, and
            the same rule as the detail page's own header decides which: that
            file already gates the badge on `origin === 'capture'`, and says
            why. This card was the surface still showing every contributed
            dataset as "Stale" on the day it was declared, and showing nothing
            at all to distinguish one you can type into from the captures
            either side of it in the grid. */}
        {dataset.origin === 'capture' && <FreshnessBadge freshness={dataset.freshness} />}
        {isContributed && (
          <Badge variant="outline">
            <PencilLine />
            <span className="text-foreground">Managed</span>
          </Badge>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {dataset.rowCount.toLocaleString()} rows
        </span>
      </CardContent>
      {tags.length > 0 && (
        <CardFooter>
          <TagsControl tags={dataset.tags} className="relative" />
        </CardFooter>
      )}
    </Card>
  )
}
