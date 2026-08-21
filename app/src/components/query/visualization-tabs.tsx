'use client'

import { useState, type CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import type { MockVisualization, MockQueryResult, QueryResultData } from '@/lib/mock-data'
import { EditVisualizationDialog } from '@/components/visualizations/edit-visualization-dialog'
import { VisualizationTabPanel } from './visualization-tab-panel'
import { VisualizationTabActions } from './visualization-tab-actions'
import { EmbedDialog } from './embed-dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useToast } from '@/components/shared/toast-provider'
import { useCreateVisualization, useUpdateVisualization, useDeleteVisualization } from '@/hooks/use-visualizations'
import { IconButton } from '@/components/shared/icon-button'
import { isSavedVisualization } from '@/lib/viz-choices'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CHART_FILL_VAR } from '@/components/visualizations/chart/chart-frame'

// A length, not `100%`. A percentage height resolves against the parent's own,
// and the chain from this panel down to the frame runs through the error
// boundary and the plugin renderer, neither of which has a definite height, so
// `100%` collapsed the frame to its padding: 32px, measured. A viewport-
// relative length has no such dependency and needs nothing from the ancestors.
//
// 16rem is the page chrome above the plot (header, metadata row, tab strip) and
// a little breathing room under it. max() keeps the old computed height as a
// floor, so a short window is no worse than before this existed.
const FILL_HEIGHT = 'max(24rem, calc(100vh - 16rem))'

interface VisualizationTabsProps {
  visualizations: MockVisualization[]
  queryResult: MockQueryResult | { data: QueryResultData } | null
  queryId?: number
  /**
   * Whether the owning query is safe to publish: no text parameters. Read by
   * the publish dialog, not by this component. Defaults to false because the
   * failure mode of a wrong `true` is an anonymous link to a parameterized
   * query, and the failure mode of a wrong `false` is a dialog that explains
   * itself.
   */
  isQuerySafe?: boolean
  /**
   * Runs the query behind these tabs, from the empty state. Optional because
   * the editor never shows that state: it mounts these tabs only once a run
   * has produced a result, so it has nothing to offer a Run button for.
   */
  onRun?: () => void
  isRunning?: boolean
  /**
   * Blocks the Run button without hiding it. Distinct from `isRunning`, which
   * also swaps the copy to "Running the query…": here the run is refused, not
   * under way. Set while a parameter edit is unapplied, so this control cannot
   * start a run with the values the viewer has already replaced.
   */
  runDisabled?: boolean
  /**
   * Give the panel the height it has room for, and let its chart fill it.
   *
   * Set by the standalone query page, which is a whole screen with one chart
   * on it. Left off by the editor's results pane, where the split pane already
   * owns the height.
   */
  fill?: boolean
}

export function VisualizationTabs({
  visualizations,
  queryResult,
  queryId,
  isQuerySafe = false,
  onRun,
  isRunning = false,
  runDisabled = false,
  fill = false,
}: VisualizationTabsProps) {
  const [activeTab, setActiveTab] = useState(visualizations[0]?.id ?? 0)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingViz, setEditingViz] = useState<MockVisualization | undefined>(undefined)
  // Deleting a saved visualization cannot be undone from the UI, and its only
  // friction used to be that the control sat inside a dropdown.
  const [deletingViz, setDeletingViz] = useState<MockVisualization | null>(null)
  // The tab being published, so the dialog is scoped to the visualization the
  // person is LOOKING at. The old page-level dialog took visualizations[0],
  // which published the table when the ticker was on screen.
  const [publishingViz, setPublishingViz] = useState<MockVisualization | null>(null)
  const toast = useToast()
  const createViz = useCreateVisualization()
  const updateViz = useUpdateVisualization()
  const deleteViz = useDeleteVisualization()

  const resultData = queryResult?.data ?? null

  const activeExists = visualizations.some((v) => v.id === activeTab)
  const effectiveActiveTab = activeExists ? activeTab : (visualizations[0]?.id ?? 0)

  const handleAddNew = () => {
    setEditingViz(undefined)
    setEditDialogOpen(true)
  }

  const handleEdit = (viz: MockVisualization) => {
    setEditingViz(viz)
    setEditDialogOpen(true)
  }

  const handleDelete = () => {
    if (!queryId || !deletingViz) return
    const vizId = deletingViz.id
    const name = deletingViz.name
    deleteViz.mutate(
      { queryId, vizId },
      {
        onSuccess: () => {
          setDeletingViz(null)
          if (activeTab === vizId) {
            const next = visualizations.find((v) => v.id !== vizId)
            setActiveTab(next?.id ?? 0)
          }
        },
        // The tab used to disappear on click regardless, so a delete the server
        // refused looked exactly like one it accepted until the page reloaded.
        onError: () => {
          setDeletingViz(null)
          toast.error(`Could not delete ${name}. It is still here.`)
        },
      }
    )
  }

  const handleSave = (vizData: { type: string; name: string; options: Record<string, unknown> }) => {
    if (!queryId) return
    if (editingViz) {
      updateViz.mutate(
        {
          queryId,
          vizId: editingViz.id,
          type: vizData.type,
          name: vizData.name,
          options: vizData.options,
        },
        {
          onError: () => toast.error(`Could not save ${vizData.name}. Your changes are not stored.`),
        }
      )
    } else {
      createViz.mutate(
        {
          queryId,
          type: vizData.type,
          name: vizData.name,
          options: vizData.options,
        },
        {
          // Selected as soon as the id exists, not once the tab does. The list is
          // the parent's, refetched by the invalidation this create triggers, so
          // it arrives a beat later; until it does `effectiveActiveTab` falls back
          // to the first visualization, and the moment the new one lands this
          // selection takes. Without it Save closed the dialog onto the tab the
          // analyst was already on, and the chart they had just built was nowhere
          // on screen.
          onSuccess: (created) => setActiveTab(created.id),
          // A create the backend refused used to look exactly like one it took:
          // the dialog closed either way and no tab appeared.
          onError: () =>
            toast.error(`Could not add ${vizData.name}. It was not saved to this query.`),
        }
      )
    }
  }

  return (
    <div className="flex flex-col">
      <Tabs value={String(effectiveActiveTab)} onValueChange={(v) => { if (v != null) setActiveTab(Number(v)) }} className="gap-0">
        <div className="flex items-center border-b bg-card px-2">
          <TabsList variant="line">
            {visualizations.map((viz) => (
              <div key={viz.id} className="relative flex items-center">
                {/* Double-click opens the editor, which is where a Redash user
                    reaches for it first. Closed for the synthetic tabs of an
                    ad hoc run, like the action cluster below. */}
                <TabsTrigger
                  value={String(viz.id)}
                  onDoubleClick={
                    queryId && viz.type !== 'TABLE' && isSavedVisualization(viz)
                      ? () => handleEdit(viz)
                      : undefined
                  }
                >
                  {viz.name}
                </TabsTrigger>
                {/* Only for saved rows: an ad hoc run's tabs carry synthetic
                    ids (0 and -1) with nothing behind them, so every action
                    they could offer, publish included, can only 404. */}
                {queryId && effectiveActiveTab === viz.id && isSavedVisualization(viz) && (
                  <VisualizationTabActions
                    viz={viz}
                    canModify={viz.type !== 'TABLE'}
                    onEdit={() => handleEdit(viz)}
                    onPublish={() => setPublishingViz(viz)}
                    onDelete={() => setDeletingViz(viz)}
                  />
                )}
              </div>
            ))}
          </TabsList>
          {queryId && (
            <IconButton tooltip="Add visualization" variant="ghost" size="sm" onClick={handleAddNew}>
              <Plus className="h-4 w-4" />
            </IconButton>
          )}
        </div>
        {visualizations.map((viz) => (
          // `fill` gives this panel a definite height and opts its charts into
          // filling it (CHART_FILL_VAR). Without it a chart is its own computed
          // height and the rest of the page is blank: measured on /queries/78
          // at 1825px tall, a 198-point series drew in 352px with 1318px empty
          // under it, so every dip in the line was a few pixels. It is a prop
          // rather than always-on because this component is also the editor's
          // results pane, where the split pane already bounds the height and a
          // second claim on it would fight the drag handle.
          <TabsContent
            key={viz.id}
            value={String(viz.id)}
            className="flex-1"
            style={fill ? ({ [CHART_FILL_VAR]: FILL_HEIGHT } as CSSProperties) : undefined}
          >
            <VisualizationTabPanel
              viz={viz}
              resultData={resultData}
              isRunning={isRunning}
              onRun={onRun}
              runDisabled={runDisabled}
              queryId={queryId}
            />
          </TabsContent>
        ))}
      </Tabs>
      {/* Mounted per visit and keyed by what is being edited. The dialog seeds
          its type, name and options from `visualization` with `useState`, which
          runs on mount and never again. Left mounted beside the tabs it
          initialised once, before any pencil was clicked, so it held the TABLE
          default for the rest of the page's life: every open read "Edit Table"
          over a table editor whatever chart you picked, and Save wrote that
          default over the chart's real options. */}
      {resultData && editDialogOpen && (
        <EditVisualizationDialog
          key={editingViz?.id ?? 'new'}
          open
          onClose={() => setEditDialogOpen(false)}
          visualization={editingViz}
          data={resultData}
          onSave={handleSave}
        />
      )}

      {/* Same mount discipline as the edit dialog above, for the same reason:
          the publish dialog holds per-open state, so it mounts fresh for the
          tab being published. The token itself outlives the dialog on the
          owning query's cache entry, which the share mutations settle; a fresh
          open reads it back through `publishingViz.api_key`. queryId is
          guaranteed by the action cluster's own gate, and checked again only
          for the type. */}
      {publishingViz && queryId && (
        <EmbedDialog
          key={publishingViz.id}
          open
          onClose={() => setPublishingViz(null)}
          visualizationId={publishingViz.id}
          queryId={queryId}
          isSafe={isQuerySafe}
          shareToken={publishingViz.api_key ?? null}
        />
      )}

      <ConfirmDialog
        open={deletingViz !== null}
        onOpenChange={(next) => {
          if (!next) setDeletingViz(null)
        }}
        title="Delete visualization?"
        description={
          <>
            <strong>{deletingViz?.name}</strong> will be removed from this query. Any dashboard
            widget built on it will lose what it was showing. This cannot be undone.
          </>
        }
        isPending={deleteViz.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
