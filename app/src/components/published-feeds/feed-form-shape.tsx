'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { PublishedFeedInput } from '@/types/published-feed'

// The only legal values today, per the API's own types. Stated as facts
// rather than a one-option dropdown: a control with a single choice invites
// clicking it to see what else is there, and there is nothing else.
export const STANDARD: PublishedFeedInput['standard'] = 'gtfs-rt'
export const VERSION: PublishedFeedInput['version'] = '2.0'

interface ShapeSectionProps {
  /** The entity to show. In picker mode this is also the Select's value. */
  entity: string
  onEntityChange: (entity: string) => void
  /**
   * True renders a picker, false renders `entity` as a stated fact.
   * `options` is only read when this is true.
   */
  isPicker: boolean
  options: string[]
}

/**
 * Split out of feed-form.tsx to keep that file under the size hook, not to
 * satisfy it with a hook: a hook returning `entity`/`onEntityChange` would
 * make the callback that closes over the setter fail
 * react-hooks/preserve-manual-memoization, the same reason
 * feed-form-on-failure.tsx gives for being a component and not a hook. The
 * derivation of which mode to render lives in entity-selection.ts, not here:
 * this component only draws whichever mode it is told to.
 *
 * Design section 4, "One consequence, and it is a good one": the same form
 * serves both editions, one entry renders as this fact and several render as
 * this picker.
 */
export function ShapeSection({ entity, onEntityChange, isPicker, options }: ShapeSectionProps) {
  const entityId = useId()

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>Shape</h2>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <ShapeFact label="Standard" value={STANDARD} />
        <ShapeFact label="Version" value={VERSION} />
        {isPicker ? (
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">
              <Label htmlFor={entityId}>Entity</Label>
            </dt>
            <dd>
              <Select value={entity} onValueChange={(v) => v && onEntityChange(v as string)}>
                <SelectTrigger id={entityId} className="h-8 w-full font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </dd>
          </div>
        ) : (
          <ShapeFact label="Entity" value={entity} />
        )}
      </dl>
    </div>
  )
}

function ShapeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  )
}
