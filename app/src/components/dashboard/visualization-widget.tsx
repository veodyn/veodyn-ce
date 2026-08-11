'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, GripVertical } from 'lucide-react'
import type { MockDashboardWidget } from '@/lib/mock-data'
import { useQueryById } from '@/hooks/use-queries'
import { useUpdateVisualization } from '@/hooks/use-visualizations'
import { useWidgetData } from '@/hooks/use-widget-data'
import { widgetParameters } from '@/lib/parameters/dashboard-parameters'
import { usePolicy } from '@/lib/policy'
import { visualizationData } from '@/lib/visualizations'
import { useToast } from '@/components/shared/toast-provider'
import { EditVisualizationDialog } from '@/components/visualizations/edit-visualization-dialog'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'
import { VisualizationErrorBoundary } from '@/components/visualizations/visualization-error-boundary'
import { annotationsForWidget } from '@/lib/annotation-overlay'
import type { Annotation } from '@/types/annotation'
import { ExpandedWidgetDialog } from './expanded-widget-dialog'
import { AnnotationDialog } from './annotation-dialog'
import { WidgetControls } from './widget-controls'
import { widgetXValues } from './widget-x-values'

interface VisualizationWidgetProps {
  widget: MockDashboardWidget
  isEditing: boolean
  onRemove?: () => void
  annotations?: Annotation[]
  /**
   * The dashboard-level parameter values, keyed by dashboard parameter name.
   * Translated here into what this widget's own query calls them, because the
   * mapping from one to the other is per widget.
   */
  dashboardValues?: Record<string, unknown>
  /**
   * Rendered through a public share token, with no session behind it. Controls
   * that lead into the authenticated app are dropped rather than shown and
   * bounced to a sign-in page.
   */
  isPublic?: boolean
}

export function VisualizationWidget({
  widget,
  isEditing,
  onRemove,
  annotations,
  dashboardValues,
  isPublic = false,
}: VisualizationWidgetProps) {
  // dashboard-grid only mounts this component for widgets that carry a
  // visualization (see the widget.visualization ? <VisualizationWidget/> : null
  // branch there), so the field is always present at this call site even
  // though the shared MockDashboardWidget type marks it optional.
  const viz = widget.visualization as NonNullable<typeof widget.visualization>
  const queryId = viz.query.id
  // Real widget payloads carry the query name inline; mock resolves it from the store
  const { data: query } = useQueryById(viz.query.name ? undefined : queryId)
  const queryName = viz.query.name ?? query?.name
  // Memoised because it is part of the widget-data cache key and a fresh object
  // each render would refetch forever.
  const parameters = useMemo(
    () => widgetParameters(widget, dashboardValues ?? {}),
    [widget, dashboardValues]
  )
  const { data: queryResult, isLoading, isRefetching, refresh } = useWidgetData(widget, parameters)
  const [expanded, setExpanded] = useState(false)
  const [annotateOpen, setAnnotateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  const toast = useToast()
  const updateViz = useUpdateVisualization()
  // The widget's own copy of the query carries its owner (serialize_query with
  // with_user), so this is admin-or-owner without a request per widget. An
  // unknown owner answers no, which is the right way round: a control that is
  // absent asks nothing of the reader, and one that fails on Save wasted their
  // time and their edit.
  const canEditViz = usePolicy().canEditQuery(viz.query)

  useEffect(() => {
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const handleSaveViz = (next: { type: string; name: string; options: Record<string, unknown> }) => {
    updateViz.mutate(
      { queryId, vizId: viz.id, type: next.type, name: next.name, options: next.options },
      {
        // Closed on click either way. Holding the dialog open until the write
        // lands would need a busy state the dialog does not have, and the widget
        // behind it is where the result shows: the invalidation in the hook
        // refetches the dashboard, so a saved edit redraws here.
        onError: () => toast.error(`Could not save ${next.name}. Your changes are not stored.`),
      }
    )
    setEditOpen(false)
  }

  const visualization = {
    id: viz.id,
    type: viz.type,
    name: viz.name,
    description: viz.description,
    options: viz.options,
    created_at: '',
    updated_at: '',
  }

  // Only CHART widgets with a datetime x-axis get markers placed: annotations
  // are a time-series feature, so a chart whose x-axis is a category (even
  // one that happens to look date-parseable, e.g. "2025"/"2026" year labels)
  // gets no annotations prop at all rather than a wrongly-placed one.
  const chartXInfo =
    viz.type === 'CHART' && queryResult?.data ? widgetXValues(visualization, queryResult.data) : null
  const placedAnnotations = chartXInfo?.xIsDatetime
    ? annotationsForWidget(annotations ?? [], widget.id, chartXInfo.xValues)
    : undefined

  // Null means "show the empty state". A type that draws from something other
  // than this query's rows gets an empty result instead, so it renders here and
  // opens expanded like any other widget.
  const data = visualizationData(viz.type, queryResult?.data)

  const title = queryName ?? `Query #${queryId}`

  return (
    <>
      <div className="h-full bg-card rounded-lg border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          {/* The title takes the free space and the visualization suffix gives
              way first, so a wide widget stops clipping its name to a few
              characters. The full name stays available on hover. */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isEditing && (
              <div className="widget-drag-handle shrink-0 cursor-move">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            {/* Plain text on a public dashboard. The title is the widget's
                second link into /queries/<id>, so gating only the icon beside
                it would have left the same dead end one click to the left. */}
            {isPublic ? (
              <span title={title} className="min-w-0 truncate text-sm font-medium">
                {title}
              </span>
            ) : (
              <Link
                href={`/queries/${queryId}`}
                title={title}
                className="min-w-0 truncate text-sm font-medium hover:text-primary"
              >
                {title}
              </Link>
            )}
            {viz.name !== 'Table' && (
              <span className="shrink truncate text-xs text-muted-foreground">· {viz.name}</span>
            )}
          </div>
          <WidgetControls
            now={now}
            retrievedAt={queryResult?.retrieved_at}
            onRefresh={handleRefresh}
            refreshing={refreshing || isRefetching}
            onExpand={() => setExpanded(true)}
            onAnnotate={() => setAnnotateOpen(true)}
            canEdit={canEditViz && data != null}
            onEdit={() => setEditOpen(true)}
            queryId={queryId}
            isPublic={isPublic}
            isEditing={isEditing}
            onRemove={onRemove}
          />
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : data ? (
            <VisualizationErrorBoundary>
              <VisualizationRenderer
                visualization={visualization}
                data={data}
                annotations={placedAnnotations}
              />
            </VisualizationErrorBoundary>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No data
            </div>
          )}
        </div>
      </div>
      {data && (
        <ExpandedWidgetDialog
          open={expanded}
          onClose={() => setExpanded(false)}
          title={`${queryName ?? 'Query'} · ${viz.name}`}
          visualization={visualization}
          data={data}
          annotations={placedAnnotations}
        />
      )}
      {/* Mounted only while open, and keyed on the visualization: the dialog
          seeds its whole draft from props in useState initializers, so a
          long-lived instance would keep the options it opened with after a save
          or a refetch. The same reason visualization-tabs.tsx mounts it this
          way. */}
      {data && editOpen && (
        <EditVisualizationDialog
          key={viz.id}
          open
          onClose={() => setEditOpen(false)}
          visualization={visualization}
          data={data}
          note={`Saved on ${queryName ?? `query #${queryId}`}. Every dashboard and report showing this visualization draws the change.`}
          onSave={handleSaveViz}
        />
      )}
      <AnnotationDialog
        open={annotateOpen}
        onClose={() => setAnnotateOpen(false)}
        dashboardId={widget.dashboard_id}
        widgetId={widget.id}
      />
    </>
  )
}
