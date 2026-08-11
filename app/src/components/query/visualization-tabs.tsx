'use client'

import { useState, type CSSProperties } from 'react'
import { Plus, Pencil, Trash2, MoreVertical } from 'lucide-react'
import type { MockVisualization, MockQueryResult, QueryResultData } from '@/lib/mock-data'
import { EditVisualizationDialog } from '@/components/visualizations/edit-visualization-dialog'
import { VisualizationTabPanel } from './visualization-tab-panel'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useToast } from '@/components/shared/toast-provider'
import { useCreateVisualization, useUpdateVisualization, useDeleteVisualization } from '@/hooks/use-visualizations'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CHART_FILL_VAR } from '@/components/visualizations/chart/chart-frame'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
                    reaches for it first. */}
                <TabsTrigger
                  value={String(viz.id)}
                  onDoubleClick={
                    queryId && viz.type !== 'TABLE' ? () => handleEdit(viz) : undefined
                  }
                >
                  {viz.name}
                </TabsTrigger>
                {queryId && effectiveActiveTab === viz.id && viz.type !== 'TABLE' && (
                  <>
                    {/* Editing used to live behind the kebab next door, which
                        reads as generic overflow: "how do I edit this chart?"
                        is not a question a settings control should provoke. It
                        gets its own labelled button, and the kebab keeps the
                        destructive action, whose two clicks are the only thing
                        standing between a stray click and a deleted
                        visualization (handleDelete does not confirm). */}
                    <IconButton
                      tooltip="Edit visualization"
                      aria-label={`Edit ${viz.name}`}
                      variant="ghost"
                      size="icon-xs"
                      className="-ml-1"
                      onClick={() => handleEdit(viz)}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </IconButton>
                    <DropdownMenu>
                      {/* The tooltip wraps the menu trigger rather than
                          replacing it: the kebab has to stay the element that
                          opens the menu, so the trigger renders through it. */}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <DropdownMenuTrigger
                              aria-label={`More options for ${viz.name}`}
                              render={<Button variant="ghost" size="icon-xs" />}
                            />
                          }
                        >
                          <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>More options</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="start" className="min-w-[120px]">
                        <DropdownMenuItem onClick={() => setDeletingViz(viz)} variant="destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
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
