'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { FeedStandard } from '@/types/published-feed'

/** The standards this form can build, with the label the list page also uses. */
export const STANDARD_OPTIONS: { value: FeedStandard; label: string }[] = [
  { value: 'gtfs-rt', label: 'GTFS-Realtime' },
  { value: 'gbfs', label: 'GBFS' },
]

interface ShapeSectionProps {
  standard: FeedStandard
  onStandardChange: (standard: FeedStandard) => void
  /** True on an edit: a standard change is a different feed, like the slug. */
  standardLocked?: boolean
  version: string
  onVersionChange: (version: string) => void
  versionOptions: string[]
  /** The entity to show. In picker mode this is also the Select's value. */
  entity: string
  onEntityChange: (entity: string) => void
  /**
   * True renders a picker, false renders `entity` as a stated fact.
   * `entityOptions` is only read when this is true.
   */
  isEntityPicker: boolean
  entityOptions: string[]
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
 * Every control here follows one rule: a closed set of one renders as a stated
 * fact, because a control with a single choice invites clicking it to see what
 * else is there, and a set of several renders as a picker. That is why the
 * version is a fact for GTFS-Realtime and a picker for GBFS.
 */
export function ShapeSection({
  standard,
  onStandardChange,
  standardLocked,
  version,
  onVersionChange,
  versionOptions,
  entity,
  onEntityChange,
  isEntityPicker,
  entityOptions,
}: ShapeSectionProps) {
  const standardId = useId()
  const versionId = useId()
  const entityId = useId()

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>Shape</h2>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        {standardLocked ? (
          <ShapeFact label="Standard" value={standard} />
        ) : (
          <ShapeChoice
            id={standardId}
            label="Standard"
            value={standard}
            onChange={(next) => onStandardChange(next as FeedStandard)}
            options={STANDARD_OPTIONS.map((option) => option.value)}
            labels={Object.fromEntries(STANDARD_OPTIONS.map((o) => [o.value, o.label]))}
          />
        )}
        {versionOptions.length > 1 ? (
          <ShapeChoice
            id={versionId}
            label="Version"
            value={version}
            onChange={onVersionChange}
            options={versionOptions}
          />
        ) : (
          <ShapeFact label="Version" value={version} />
        )}
        {isEntityPicker ? (
          <ShapeChoice
            id={entityId}
            label="Entity"
            value={entity}
            onChange={onEntityChange}
            options={entityOptions}
          />
        ) : (
          <ShapeFact label="Entity" value={entity} />
        )}
      </dl>
    </div>
  )
}

function ShapeChoice({
  id,
  label,
  value,
  onChange,
  options,
  labels,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  options: string[]
  labels?: Record<string, string>
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">
        <Label htmlFor={id}>{label}</Label>
      </dt>
      <dd>
        <Select value={value} onValueChange={(v) => v && onChange(v as string)}>
          <SelectTrigger id={id} className="h-8 w-full font-mono text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {labels?.[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </dd>
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
