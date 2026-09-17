'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fieldsFor } from '@/lib/gbfs-fields'
import { missingRequired } from '@/lib/gtfs-fields'
import { useFeedCapabilities, useQueryResultColumns } from '@/hooks/use-published-feeds'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import { QueryPicker } from './query-picker'
import { AddressSection } from './feed-form-address'
import { MappingSection } from './feed-form-mapping'
import { OnFailureSection, lastGoodAgeError } from './feed-form-on-failure'
import { ShapeSection } from './feed-form-shape'
import { SystemInfoSection } from './system-info-section'
import { buildInput, submitError, systemFieldErrors, type FormValues } from './feed-form-submit'
import { resolveEntityNeeds, resolveEntitySelection } from './entity-selection'
import { useStaticGtfsRef } from './static-gtfs-ref'
import type { FeedStandard, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'

interface FeedFormProps {
  /** Prefilled for an edit, absent for a create. */
  initial?: PublishedFeed
  defaultEntity?: string
  /** Locked on edit: the slug is half the primary key and cannot be renamed. */
  slugLocked?: boolean
  submitLabel: string
  isPending: boolean
  error: string | null
  fieldErrors: Record<string, string>
  onSubmit: (input: PublishedFeedInput) => void
  onCancel: () => void
}

export const NO_SOURCE_QUERY =
  'No source query: this feed serves whatever is published to it, such as rider messages.'

// What each standard starts a create form on, and what a version picker falls
// back to before capabilities resolve.
const DEFAULT_VERSION: Record<FeedStandard, string> = { 'gtfs-rt': '2.0', gbfs: '2.3' }
const FALLBACK_VERSIONS: Record<FeedStandard, string[]> = {
  'gtfs-rt': ['2.0'],
  gbfs: ['2.3', '3.0'],
}

function initialSelection(
  feed: PublishedFeed | undefined,
  standard: FeedStandard,
  entity: string | undefined
): Record<string, string | null> {
  const selection: Record<string, string | null> = {}
  for (const field of fieldsFor(standard, entity)) selection[field.name] = feed?.columnMap[field.name] ?? null
  return selection
}

export function FeedForm({
  initial,
  defaultEntity,
  slugLocked,
  submitLabel,
  isPending,
  error,
  fieldErrors,
  onSubmit,
  onCancel,
}: FeedFormProps) {
  const [standard, setStandard] = useState<FeedStandard>(initial?.standard ?? 'gtfs-rt')
  const [version, setVersion] = useState(initial?.version ?? DEFAULT_VERSION[standard])
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [visibility, setVisibility] = useState<PublishedFeedInput['visibility']>(
    initial?.visibility ?? 'private'
  )
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(initial?.queryId ?? null)
  const [selection, setSelection] = useState<Record<string, string | null>>(() =>
    initialSelection(initial, initial?.standard ?? 'gtfs-rt', initial?.entity)
  )
  // The query id the current `selection` was built against, tracked apart
  // from `selectedQueryId` (which goes back to null while QueryPicker is in
  // its search view, between clicking "Change" and picking the next query).
  // Re-picking the same query after Change must keep the mapping; picking a
  // different one must clear it, whether this is a fresh create or an edit
  // that started with a prefilled columnMap.
  const [mappedQueryId, setMappedQueryId] = useState<number | null>(initial?.queryId ?? null)
  const staticRef = useStaticGtfsRef(initial?.staticGtfsRef ?? null)
  const [systemInfo, setSystemInfo] = useState<Record<string, string>>(initial?.systemInfo ?? {})
  const [onError, setOnError] = useState<PublishedFeedInput['onError']>(initial?.onError ?? 'block')
  const [lastGoodMaxAgeSeconds, setLastGoodMaxAgeSeconds] = useState(
    initial?.lastGoodMaxAgeSeconds != null ? String(initial.lastGoodMaxAgeSeconds) : ''
  )
  const [chosenRetire, setRetireOnFailure] = useState<boolean | null>(initial?.retireOnFailure ?? null)
  const [pickedEntity, setPickedEntity] = useState<string | null>(defaultEntity ?? null)
  const [attempted, setAttempted] = useState(false)

  const { data: resultColumns } = useQueryResultColumns(selectedQueryId)
  const columns = resultColumns?.columns ?? []
  const ageError = attempted ? lastGoodAgeError(onError, lastGoodMaxAgeSeconds) : null

  const {
    data: capabilities,
    isLoading: capabilitiesLoading,
    isError: capabilitiesError,
  } = useFeedCapabilities()
  // Undefined covers both "still loading" and "the request failed": both
  // degrade to the single-fact form rather than an empty picker or a spinner
  // blocking the whole form. A deployment registering one entity for this
  // standard must never see the form degrade because a secondary request was slow.
  const capability = capabilitiesLoading || capabilitiesError
    ? undefined
    : capabilities?.standards.find((entry) => entry.standard === standard)
  const versionOptions = capability?.versions ?? FALLBACK_VERSIONS[standard]
  const entitySelection = resolveEntitySelection(
    capability?.entities,
    initial?.entity,
    pickedEntity,
    standard
  )
  // Which sections render at all. The registry answers it, not the standard:
  // an entity's producer is what decides whether there is a query behind this
  // feed, a static schedule to check it against, or a column map to build it
  // from, and the answer differs between two entities of the same standard.
  const needs = resolveEntityNeeds(capability?.entityNeeds, entitySelection.entity, standard)
  const mustRetire = needs.retirementOnFailure
  const retireOnFailure = chosenRetire ?? mustRetire

  // After the entity is resolved: under gbfs the shape, not the standard, picks
  // the vocabulary.
  const fields = fieldsFor(standard, entitySelection.entity)
  const missing = needs.columnMap ? missingRequired(fields, selection) : []

  const mappingErrors: Record<string, string> = {}
  for (const field of fields) {
    if (fieldErrors[field.name]) mappingErrors[field.name] = fieldErrors[field.name]
  }
  if (attempted) {
    for (const name of missing) {
      mappingErrors[name] = mappingErrors[name] ?? 'This field is required and is not mapped.'
    }
  }

  const values: FormValues = {
    slug,
    queryId: selectedQueryId,
    needs,
    standard,
    version,
    entity: entitySelection.entity,
    staticGtfsRef: staticRef.value,
    systemInfo,
    selection,
    onError,
    lastGoodMaxAgeSeconds,
    retireOnFailure,
    visibility,
  }

  const systemErrors = attempted ? systemFieldErrors(values) : {}
  const problem = attempted
    ? (submitError(values) ?? lastGoodAgeError(onError, lastGoodMaxAgeSeconds))
    : null

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
      setSelection(initialSelection(undefined, standard, entitySelection.entity))
      setMappedQueryId(queryId)
    }
    setSelectedQueryId(queryId)
  }

  // The same doctrine one step up: the two standards share no field vocabulary,
  // so a map built for one names nothing the other writes. Everything the old
  // standard owned is cleared rather than carried across.
  const handleStandardChange = (next: FeedStandard) => {
    if (next === standard) return
    setStandard(next)
    setVersion(DEFAULT_VERSION[next])
    setSelection(initialSelection(undefined, next, undefined))
    setPickedEntity(null)
    staticRef.reset()
    setSystemInfo({})
  }

  const handleSubmit = () => {
    setAttempted(true)
    if (submitError(values) ?? lastGoodAgeError(onError, lastGoodMaxAgeSeconds)) return
    onSubmit(buildInput(values, initial))
  }

  const shownError = problem ?? error

  return (
    <Card>
      <CardContent className="space-y-6">
        {/* First, because it decides the rest of the form: the field
            vocabulary, whether a static reference or a system declaration is
            asked for, and what a change here clears. */}
        <ShapeSection
          standard={standard}
          onStandardChange={handleStandardChange}
          // An edit cannot change standards. The stored artifacts, the column
          // map and the system declaration all belong to the one it was created
          // under, so switching is a different feed, like the slug.
          standardLocked={Boolean(initial)}
          version={version}
          onVersionChange={setVersion}
          versionOptions={versionOptions}
          entity={entitySelection.entity}
          onEntityChange={setPickedEntity}
          isEntityPicker={entitySelection.isPicker}
          entityOptions={entitySelection.options}
        />

        {needs.query ? (
          <div className="space-y-3">
            <h2 className={SUBSECTION_HEADING}>Source</h2>
            <QueryPicker
              selectedQueryId={selectedQueryId}
              onSelect={handleSelectQuery}
              onClear={() => setSelectedQueryId(null)}
              error={fieldErrors.query}
              sourceIsNotAQuery={initial?.queryId === null}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{NO_SOURCE_QUERY}</p>
        )}

        <AddressSection
          slug={slug}
          onSlugChange={setSlug}
          slugLocked={slugLocked}
          slugError={fieldErrors.slug}
          visibility={visibility}
          onVisibilityChange={setVisibility}
        />

        {standard === 'gbfs' && (
          <SystemInfoSection
            version={version}
            value={systemInfo}
            onChange={(field, next) => setSystemInfo((s) => ({ ...s, [field]: next }))}
            errors={systemErrors}
            timezones={capability?.timezones ?? []}
          />
        )}

        <MappingSection
          needs={needs}
          staticRef={staticRef}
          columns={columns}
          fields={fields}
          selection={selection}
          onSelectionChange={(field, column) => setSelection((s) => ({ ...s, [field]: column }))}
          fieldErrors={mappingErrors}
        />

        <OnFailureSection
          onError={onError}
          onOnErrorChange={setOnError}
          lastGoodMaxAgeSeconds={lastGoodMaxAgeSeconds}
          onLastGoodMaxAgeSecondsChange={setLastGoodMaxAgeSeconds}
          ageError={ageError}
          retireOnFailure={retireOnFailure}
          onRetireOnFailureChange={setRetireOnFailure}
          mustRetire={mustRetire}
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
