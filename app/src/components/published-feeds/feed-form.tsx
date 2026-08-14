'use client'

import { useId, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { GTFS_FIELDS, missingRequired, toColumnMap } from '@/lib/gtfs-fields'
import { useFeedCapabilities, useQueryResultColumns } from '@/hooks/use-published-feeds'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import { QueryPicker } from './query-picker'
import { ColumnMapEditor } from './column-map-editor'
import { OnFailureSection, lastGoodAgeError } from './feed-form-on-failure'
import { STANDARD, VERSION, ShapeSection } from './feed-form-shape'
import { resolveEntitySelection } from './entity-selection'
import type { PublishedFeed, PublishedFeedInput } from '@/types/published-feed'

interface FeedFormProps {
  /** Prefilled for an edit, absent for a create. */
  initial?: PublishedFeed
  /** Locked on edit: the slug is half the primary key and cannot be renamed. */
  slugLocked?: boolean
  submitLabel: string
  isPending: boolean
  error: string | null
  fieldErrors: Record<string, string>
  onSubmit: (input: PublishedFeedInput) => void
  onCancel: () => void
}

function initialSelection(feed: PublishedFeed | undefined): Record<string, string | null> {
  const selection: Record<string, string | null> = {}
  for (const field of GTFS_FIELDS) selection[field.name] = feed?.columnMap[field.name] ?? null
  return selection
}

export function FeedForm({
  initial,
  slugLocked,
  submitLabel,
  isPending,
  error,
  fieldErrors,
  onSubmit,
  onCancel,
}: FeedFormProps) {
  const slugId = useId()
  const staticGtfsRefId = useId()

  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [visibility, setVisibility] = useState<PublishedFeedInput['visibility']>(
    initial?.visibility ?? 'private'
  )
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(initial?.queryId ?? null)
  const [selection, setSelection] = useState<Record<string, string | null>>(() => initialSelection(initial))
  // The query id the current `selection` was built against, tracked apart
  // from `selectedQueryId` (which goes back to null while QueryPicker is in
  // its search view, between clicking "Change" and picking the next query).
  // Re-picking the same query after Change must keep the mapping; picking a
  // different one must clear it, whether this is a fresh create or an edit
  // that started with a prefilled columnMap.
  const [mappedQueryId, setMappedQueryId] = useState<number | null>(initial?.queryId ?? null)
  const [staticGtfsRef, setStaticGtfsRef] = useState(initial?.staticGtfsRef ?? '')
  const [onError, setOnError] = useState<PublishedFeedInput['onError']>(initial?.onError ?? 'block')
  const [lastGoodMaxAgeSeconds, setLastGoodMaxAgeSeconds] = useState(
    initial?.lastGoodMaxAgeSeconds != null ? String(initial.lastGoodMaxAgeSeconds) : ''
  )
  // Only meaningful once resolveEntitySelection says this is a picker; null
  // until the reader picks something of their own.
  const [pickedEntity, setPickedEntity] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  // Set once the reader has tried to submit, so the missing-field rows below
  // update live as fields are mapped rather than staying stuck on whatever was
  // missing at the moment of the first attempt.
  const [attempted, setAttempted] = useState(false)

  const { data: resultColumns } = useQueryResultColumns(selectedQueryId ?? undefined)
  const columns = resultColumns?.columns ?? []
  const missing = missingRequired(selection)
  const ageError = attempted ? lastGoodAgeError(onError, lastGoodMaxAgeSeconds) : null

  const {
    data: capabilities,
    isLoading: capabilitiesLoading,
    isError: capabilitiesError,
  } = useFeedCapabilities()
  // Undefined covers both "still loading" and "the request failed": both
  // degrade to the single-fact form rather than an empty picker or a spinner
  // blocking the whole form. A community deployment has exactly one entity
  // and must never see the form degrade because a secondary request was slow.
  const registeredEntities =
    capabilitiesLoading || capabilitiesError ? undefined : capabilities?.entities
  const entitySelection = resolveEntitySelection(registeredEntities, initial?.entity, pickedEntity)

  const mappingErrors: Record<string, string> = {}
  for (const field of GTFS_FIELDS) {
    if (fieldErrors[field.name]) mappingErrors[field.name] = fieldErrors[field.name]
  }
  if (attempted) {
    for (const name of missing) {
      mappingErrors[name] = mappingErrors[name] ?? 'This field is required and is not mapped.'
    }
  }

  // A field mapped against one query's columns is meaningless (and possibly
  // unreachable-by-construction-breaking) against a different query's
  // columns: `add-widget-search`'s sibling in destinations/new resets its
  // whole form on a type change for the same reason ("picking Slack, filling
  // it, going back and picking PagerDuty used to carry the Slack webhook URL
  // into a form that has no such field, and send it"). Compared against
  // `mappedQueryId` rather than `selectedQueryId`, so re-picking the same
  // query after "Change" keeps the mapping instead of wiping it.
  const handleSelectQuery = (queryId: number) => {
    if (queryId !== mappedQueryId) {
      setSelection(initialSelection(undefined))
      setMappedQueryId(queryId)
    }
    setSelectedQueryId(queryId)
  }

  const handleSubmit = () => {
    setAttempted(true)
    if (missing.length > 0) {
      setLocalError(`Map every required field before publishing: ${missing.join(', ')}.`)
      return
    }
    if (selectedQueryId == null) {
      setLocalError('Pick a source query before publishing.')
      return
    }
    if (!slug.trim()) {
      setLocalError('Give this feed an address before publishing.')
      return
    }
    if (!staticGtfsRef.trim()) {
      setLocalError('A static GTFS reference is required.')
      return
    }
    const capError = lastGoodAgeError(onError, lastGoodMaxAgeSeconds)
    if (capError) {
      setLocalError(capError)
      return
    }
    setLocalError(null)
    onSubmit({
      slug: slug.trim(),
      queryId: selectedQueryId,
      standard: STANDARD,
      version: VERSION,
      entity: entitySelection.entity,
      staticGtfsRef: staticGtfsRef.trim(),
      // Carried through, never re-sent as null. The endpoint is a whole-binding
      // PUT, and `source_column` is real: it records the provenance of a row and
      // is required at hub tier. Bindings created by calling the sidecar
      // directly are the premise of this whole surface, so a hardcoded null here
      // meant the first edit of one silently threw the field away. This form
      // offers no editor for it, which is fine; destroying it is not.
      sourceColumn: initial?.sourceColumn ?? null,
      columnMap: toColumnMap(selection),
      onError,
      lastGoodMaxAgeSeconds: onError === 'last_good' ? Number(lastGoodMaxAgeSeconds) : null,
      visibility,
    })
  }

  const shownError = localError ?? error

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h2 className={SUBSECTION_HEADING}>Source</h2>
          <QueryPicker
            selectedQueryId={selectedQueryId}
            onSelect={handleSelectQuery}
            onClear={() => setSelectedQueryId(null)}
            error={fieldErrors.query}
          />
        </div>

        <div className="space-y-3">
          <h2 className={SUBSECTION_HEADING}>Address</h2>
          <div className="space-y-1">
            <Label htmlFor={slugId}>Slug</Label>
            <Input
              id={slugId}
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              disabled={slugLocked}
              placeholder="vehicles-live"
            />
            {fieldErrors.slug && (
              <p role="alert" className="text-sm text-destructive">
                {fieldErrors.slug}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Visibility</Label>
            <RadioGroup
              value={visibility}
              onValueChange={(v) => v && setVisibility(v as PublishedFeedInput['visibility'])}
            >
              <VisibilityOption value="private" label="Private" description="Only signed-in org members can read it." />
              <VisibilityOption value="public" label="Public" description="Anyone with the URL can read it." />
            </RadioGroup>
          </div>
        </div>

        <ShapeSection
          entity={entitySelection.entity}
          onEntityChange={setPickedEntity}
          isPicker={entitySelection.isPicker}
          options={entitySelection.options}
        />

        <div className="space-y-3">
          <h2 className={SUBSECTION_HEADING}>Mapping</h2>
          <div className="space-y-1">
            <Label htmlFor={staticGtfsRefId}>Static GTFS reference</Label>
            <Input
              id={staticGtfsRefId}
              type="text"
              value={staticGtfsRef}
              onChange={(e) => setStaticGtfsRef(e.target.value)}
              placeholder="the static feed this realtime feed extends"
            />
          </div>
          <ColumnMapEditor
            columns={columns}
            selection={selection}
            onChange={(field, column) => setSelection((s) => ({ ...s, [field]: column }))}
            fieldErrors={mappingErrors}
          />
        </div>

        <OnFailureSection
          onError={onError}
          onOnErrorChange={setOnError}
          lastGoodMaxAgeSeconds={lastGoodMaxAgeSeconds}
          onLastGoodMaxAgeSecondsChange={setLastGoodMaxAgeSeconds}
          ageError={ageError}
        />

        {shownError && (
          <p role="alert" className="text-sm text-destructive">
            {shownError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function VisibilityOption({ value, label, description }: { value: string; label: string; description: string }) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <Label htmlFor={id} className="flex flex-col gap-0.5 font-normal">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </Label>
    </div>
  )
}
