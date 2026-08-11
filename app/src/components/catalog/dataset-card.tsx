import Link from 'next/link'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { TagsControl } from '@/components/shared/tags-control'
import { visibleTags } from '@/lib/tags'
import { FreshnessBadge } from './freshness-badge'
import type { Dataset } from '@/types/catalog'

export function DatasetCard({ dataset }: { dataset: Dataset }) {
  // `domain:*` tags drive the hub filter above and are never chips, which is
  // the same rule TagsControl applies everywhere else.
  const tags = visibleTags(dataset.tags)

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
        <FreshnessBadge freshness={dataset.freshness} />
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
