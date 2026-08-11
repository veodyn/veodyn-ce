'use client'

// The deterministic Visual builder: a field picker over ONE dataset that
// composes a VisualQuerySpec and compiles it with the pure compileVisualQuery.
// There is no model call anywhere in this surface (AI spec section 3).
//
// Two areas, because there are two decisions here: what to fetch (Data) and how
// to show it (Visualization). They used to be one column of controls with the
// visualization choice as a select at the bottom of it, which read as an empty
// right-hand panel with one stranded control.
//
// Moving between Visual and PRO is free in both directions. Raw SQL is still
// never parsed back into the visual model, so the two surfaces can hold
// different queries, and the picks survive the trip because the page owns the
// draft. Run publishes this builder's SQL into the PRO buffer, which is the
// point of the button and does not need announcing before it happens.
import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, Code, GitBranch, Loader2, Play, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { useDataset } from '@/hooks/use-catalog'
import { needsJoin } from '@/lib/visual-query'
import { type AdhocViz, adhocVizFor, resolveVizChoice } from '@/lib/viz-choices'
import type { VisualQuerySpec } from '@/types/ai'
import { VisualBuilderFields } from './visual-builder-fields'
import { VisualBuilderVizPicker } from './visual-builder-viz-picker'
import {
  type VisualDraft,
  activeFilters,
  compileSafely,
  datasetTableName,
  emptyVisualDraft,
  parseLimit,
} from './visual-builder-model'

const NOTICE = 'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm'
const AREA_HEADING = 'text-sm font-semibold'

export interface VisualBuilderProps {
  datasetId: string
  /**
   * Run, carrying the visualization the picker is set to. Resolved here rather
   * than passed as an id, so nothing downstream has to know that a chart shape
   * is an option on a CHART type rather than a type of its own.
   */
  onCompile: (sql: string, viz: AdhocViz) => void
  onSwitchToPro: (sql: string) => void
  /**
   * Save the composed query, carrying its SQL for the same reason Run does: the
   * caller holds the buffer, and waiting for a state round trip would save
   * whatever it held one render ago.
   *
   * Optional, and the button is only mounted with it. A builder rendered on its
   * own has nowhere to save to; the query editor always passes this.
   */
  onSave?: (sql: string) => void
  isSaving?: boolean
  /**
   * The field picks, lifted. Optional: without it the builder keeps its own,
   * which is all a standalone render needs. The query editor passes it because
   * the analyst can leave for PRO and come back, and the builder unmounts in
   * between. Held here, the picks were gone every time they returned.
   */
  draft?: VisualDraft
  onDraftChange?: (next: VisualDraft) => void
  /**
   * Why Run cannot work against the current target, or null when it can. The
   * builder only ever emits SQL and not every data source takes SQL, so the
   * caller (which knows what the query would be sent to) says so. It disables
   * Run and titles it, rather than letting the backend reject the query or
   * standing a panel of prose over the buttons.
   */
  runBlockedReason?: string | null
  /**
   * The current compiled SQL, published as the field picks change.
   *
   * The page's own PRO tab is a second door out of Visual mode, and it has to
   * carry the same SQL this builder would have handed over. Without this it
   * hands over the PRO buffer, which in Visual mode is empty, so leaving by the
   * tab silently discarded the query the analyst had just composed.
   */
  onCompiledSqlChange?: (sql: string | null) => void
}

export function VisualBuilder({
  datasetId,
  onCompile,
  onSwitchToPro,
  onSave,
  isSaving = false,
  draft: controlledDraft,
  onDraftChange,
  runBlockedReason = null,
  onCompiledSqlChange,
}: VisualBuilderProps) {
  const { data: dataset, isLoading } = useDataset(datasetId)
  const dataHeadingId = useId()
  const vizHeadingId = useId()

  const [ownDraft, setOwnDraft] = useState<VisualDraft>(emptyVisualDraft)
  const draft = controlledDraft ?? ownDraft
  const setDraft = onDraftChange ?? setOwnDraft
  const patch = (fields: Partial<VisualDraft>) => setDraft({ ...draft, ...fields })

  const columns = dataset?.schema ?? []
  const spec: VisualQuerySpec = {
    dataset: datasetTableName(datasetId),
    dimensions: draft.dimensions,
    aggregates: draft.aggregates,
    // Unfinished rows are left out rather than refused: see activeFilters.
    filters: activeFilters(draft.filters),
    sort: draft.sort,
    limit: parseLimit(draft.limit),
    // A Redash visualization type, which is what this field has always meant and
    // what an AI-authored spec puts here. The five chart shapes the picker
    // offers all resolve to CHART.
    chartType: resolveVizChoice(draft.vizId).type,
  }
  const compiled = compileSafely(spec, columns)
  const joinNeeded = needsJoin(spec)

  // What PRO receives when the current fields do not compile: the last query
  // this builder did produce, so leaving for a join does not open an empty
  // editor. Empty until the picker has compiled at least once.
  const lastCompiled = useRef('')
  useEffect(() => {
    if (compiled.sql != null) lastCompiled.current = compiled.sql
    // Published on every change, including a failure, and never skipped. Bailing
    // out when the picks stopped compiling left the *previous dataset's* SQL
    // standing in the page: selecting an uncompilable dataset and then using the
    // top PRO tab handed over a query over a table the analyst had moved off.
    //
    // The fallback is this builder's own last good SQL, matching what its
    // "Open in PRO" button hands over. Safe because the pane keys the builder by
    // dataset, so a remount resets this ref rather than carrying it across.
    onCompiledSqlChange?.(compiled.sql ?? (lastCompiled.current || null))
  }, [compiled.sql, onCompiledSqlChange])

  if (isLoading) return <SkeletonCard />
  if (!dataset) return <NoData message="This dataset was not found in the catalog." />

  const hasColumns = columns.length > 0
  const composed = hasColumns && compiled.sql != null
  const runnable = composed && runBlockedReason == null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-balance text-lg">Visual builder</CardTitle>
        <CardDescription className="text-pretty">
          Pick fields over {dataset.name}, then pick how to show them. The query is composed from
          those picks, with no model in the loop.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Data takes the larger share: its filter and sort rows are already
            three columns plus a remove button, and they crowd under about
            400px. The picker's tiles reflow instead. */}
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby={dataHeadingId} className="space-y-4">
            <h3 id={dataHeadingId} className={AREA_HEADING}>
              Data
            </h3>
            {hasColumns ? (
              <VisualBuilderFields
                columns={columns}
                dimensions={draft.dimensions}
                aggregates={draft.aggregates}
                filters={draft.filters}
                sort={draft.sort}
                limit={draft.limit}
                onDimensionsChange={(dimensions) => patch({ dimensions })}
                onAggregatesChange={(aggregates) => patch({ aggregates })}
                onFiltersChange={(filters) => patch({ filters })}
                onSortChange={(sort) => patch({ sort })}
                onLimitChange={(limit) => patch({ limit })}
              />
            ) : (
              <NoData message="This dataset has no column metadata, so there is nothing to pick here. Continue in the SQL editor to write the query by hand." />
            )}
          </section>

          {/* The picker stands whether or not the dataset has columns to pick:
              how to draw the answer does not depend on which columns exist. */}
          <section aria-labelledby={vizHeadingId} className="space-y-4 lg:border-l lg:pl-6">
            <h3 id={vizHeadingId} className={AREA_HEADING}>
              Visualization
            </h3>
            {/* Resolved, not raw: an id this build no longer offers resolves
                to the table for the run, and the picker has to agree with that
                rather than showing nothing checked. */}
            <VisualBuilderVizPicker
              value={resolveVizChoice(draft.vizId).id}
              onChange={(vizId) => patch({ vizId })}
            />
          </section>
        </div>

        {joinNeeded && (
          <p role="alert" className={`${NOTICE} border-border bg-muted text-foreground`}>
            <GitBranch className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            This query needs a cross-dataset join, which the Visual builder does not cover. Continue
            in the SQL editor to write it.
          </p>
        )}
        {!joinNeeded && compiled.error != null && (
          <p
            role="alert"
            className={`${NOTICE} border-destructive/30 bg-destructive/10 text-destructive`}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {compiled.error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {/* The reason Run is off rides on Run itself, and the caller repeats
              it under the control that caused it. It used to be a banner over
              the buttons, which is a lot of furniture for one dead button. */}
          <Button
            type="button"
            disabled={!runnable}
            title={runBlockedReason ?? undefined}
            onClick={() => {
              if (compiled.sql != null) onCompile(compiled.sql, adhocVizFor(draft.vizId))
            }}
          >
            <Play aria-hidden="true" />
            Run
          </Button>
          {/* Composing a query and keeping it were two different things, and
              only one of them had a button: the editor's own Save acts on the
              PRO buffer and is unmounted in this mode, so everything picked
              here was lost on the way out.

              Unlike Run, this does not care about runBlockedReason. Saving is
              not running, and PRO has always let a query be saved against a
              source that cannot answer it. */}
          {onSave != null && (
            <Button
              type="button"
              variant="outline"
              disabled={!composed || isSaving}
              onClick={() => {
                if (compiled.sql != null) onSave(compiled.sql)
              }}
            >
              {isSaving ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              Save
            </Button>
          )}
          {/* Straight through, no interstitial. The switch used to raise an
              "Open this query in PRO?" panel warning that the move was one way;
              it stopped everyone on the way to the thing they had just asked
              for. Nothing is committed by going: the Visual tab stays open and
              these picks are still here on the way back. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => onSwitchToPro(compiled.sql ?? lastCompiled.current)}
          >
            <Code aria-hidden="true" />
            Open in SQL Editor
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
