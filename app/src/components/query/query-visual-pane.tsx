'use client'

// The Visual mode body of the query editor: the two choices this mode needs
// (what to run against, what to compose over) plus the deterministic
// VisualBuilder. The builder composes over one catalogued dataset while the
// query still executes against a Redash data source, so the analyst says which
// dataset the picker is for rather than the page guessing from the connection.
//
// The data source lives here rather than in the editor's left rail because that
// rail is unmounted in Visual mode: the rest of it is a schema tree whose only
// action appends text to the PRO buffer, which this mode does not show.
import { useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { useCatalog } from '@/hooks/use-catalog'
import type { MockDataSource } from '@/lib/mock-data'
import type { AdhocViz } from '@/lib/viz-choices'
import { FieldSelect } from './visual-builder-controls'
import { VisualBuilder } from './visual-builder'
import type { VisualDraft } from './visual-builder-model'

interface QueryVisualPaneProps {
  datasetId: string | null
  onDatasetIdChange: (datasetId: string) => void
  dataSources: MockDataSource[]
  dataSourceId: number
  onDataSourceIdChange: (id: number) => void
  /**
   * The builder composes a visualization as well as a query, so Run carries the
   * picked one with the SQL. This used to take the SQL alone and drop the second
   * argument on the floor, which TypeScript accepts without a word (a shorter
   * function satisfies a longer function type), so the visualization control set
   * a value nothing downstream ever read.
   */
  onCompile: (sql: string, viz: AdhocViz) => void
  onSwitchToPro: (sql: string) => void
  /** Saves the composed query. Carries its SQL for the same reason Run does. */
  onSave?: (sql: string) => void
  isSaving?: boolean
  /** Passed through so the picks outlive a trip to PRO and back. */
  draft?: VisualDraft
  onDraftChange?: (next: VisualDraft) => void
  /** Passed through so the page's own PRO tab can hand off the same SQL. */
  onCompiledSqlChange?: (sql: string | null) => void
}

// The Select carries the accessible name (aria-label), so this visible label is
// a click target and a heading for the eye, not a second name for the control.
function PaneField({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string | null
  children: ReactNode
}) {
  return (
    <div className="w-full max-w-xs space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint != null && <p className="text-pretty text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function QueryVisualPane({
  datasetId,
  onDatasetIdChange,
  dataSources,
  dataSourceId,
  onDataSourceIdChange,
  onCompile,
  onSwitchToPro,
  onSave,
  isSaving,
  draft,
  onDraftChange,
  onCompiledSqlChange,
}: QueryVisualPaneProps) {
  const { data: datasets, isLoading } = useCatalog()
  const dataSourceFieldId = useId()
  const datasetFieldId = useId()

  const options = (datasets ?? []).map((dataset) => ({
    label: dataset.name,
    value: dataset.id,
  }))
  // Nothing picked yet means the first catalogued dataset, so the builder has
  // something to compose over the moment Visual mode opens.
  const selected = datasetId ?? options[0]?.value ?? null

  // The builder emits SQL and nothing else, so a source that takes some other
  // query language is not a target it can Run against. Those are offered
  // nowhere in this mode, except when one is already selected: dropping the
  // current source from its own picker would leave the trigger with a value it
  // cannot name, and the analyst without the control that got them there.
  const current = dataSources.find((source) => source.id === dataSourceId) ?? null
  const runnableHere = current == null || current.syntax === 'sql'
  const sourceOptions = dataSources
    .filter((source) => source.syntax === 'sql' || source.id === dataSourceId)
    .map((source) => ({ label: source.name, value: String(source.id) }))
  // Said once, in two words too few to be a paragraph: under the picker that
  // chose it, and on the Run button it switches off.
  const runBlockedReason = runnableHere
    ? null
    : `${current.name} takes ${current.syntax}, not SQL, so Run is off here.`
  const sourceHint = runnableHere ? null : `Takes ${current.syntax}, not SQL. Run is off.`

  if (isLoading) return <SkeletonCard />

  return (
    <div className="space-y-3 overflow-y-auto border-b p-3">
      <div className="flex flex-wrap gap-3">
        <PaneField id={dataSourceFieldId} label="Data source" hint={sourceHint}>
          <FieldSelect
            id={dataSourceFieldId}
            label="Data source"
            // Only a value this picker can put a name to. The list arrives
            // async, and until it does there is no value-to-label map, so
            // base-ui prints the raw value and the trigger reads as a bare id.
            // The placeholder is the honest answer for that moment.
            value={current ? String(dataSourceId) : ''}
            options={sourceOptions}
            disabled={sourceOptions.length === 0}
            onChange={(next) => onDataSourceIdChange(Number(next))}
          />
        </PaneField>
        <PaneField id={datasetFieldId} label="Dataset">
          <FieldSelect
            id={datasetFieldId}
            label="Dataset"
            value={selected ?? ''}
            options={options}
            disabled={options.length === 0}
            onChange={onDatasetIdChange}
          />
        </PaneField>
      </div>
      {selected != null ? (
        // Keyed by dataset so switching datasets remounts the builder and its
        // last-compiled SQL resets, instead of leaking the previous dataset's
        // query into an Open-in-PRO handoff. The picks themselves live above
        // this component now, so whoever owns the draft clears it in step.
        <VisualBuilder
          key={selected}
          datasetId={selected}
          onCompile={onCompile}
          onSwitchToPro={onSwitchToPro}
          onSave={onSave}
          isSaving={isSaving}
          draft={draft}
          onDraftChange={onDraftChange}
          runBlockedReason={runBlockedReason}
          onCompiledSqlChange={onCompiledSqlChange}
        />
      ) : (
        <NoData message="The catalog has no datasets to build over. Continue in the SQL editor to write the query by hand." />
      )}
    </div>
  )
}
