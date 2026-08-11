'use client'

import { use, useState, useCallback, useMemo } from 'react'
import { Save, X, Plus, Type } from 'lucide-react'
import { useDashboard, useUpdateDashboard } from '@/hooks/use-dashboards'
import { useCreateWidget, useUpdateWidget, useDeleteWidget, useSaveLayout } from '@/hooks/use-widgets'
import { useAnnotations } from '@/hooks/use-annotations'
import { useTagVocabulary } from '@/hooks/use-tag-vocabulary'
import { useOptimisticTags } from '@/hooks/use-optimistic-tags'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { EditInPlace } from '@/components/shared/edit-in-place'
import { TagsControl } from '@/components/shared/tags-control'
import { FavoritesControl } from '@/components/shared/favorites-control'
import { DashboardGrid } from '@/components/dashboard/dashboard-grid'
import { ParametersBar } from '@/components/parameters/parameters-bar'
import { collectDashboardParameters } from '@/lib/parameters/dashboard-parameters'
import { AddWidgetDialog, type ParameterMapping } from '@/components/dashboard/add-widget-dialog'
import { TextboxDialog } from '@/components/dashboard/textbox-dialog'
import { EditWithAiButton } from '@/components/ai/create-chat/edit-with-ai-button'
import { RefreshRatePicker } from '@/components/dashboard/refresh-rate-picker'
import { ShareDashboardDialog } from '@/components/dashboard/share-dashboard-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/shared/toast-provider'
import { PageContainer } from '@/components/layout/page-container'
import { PageLoading } from '@/components/layout/page-loading'
import { NoData } from '@/components/ui/no-data'
import { DashboardViewActions } from './dashboard-view-actions'

export default function DashboardViewPage({ params }: { params: Promise<{ dashboardId: string }> }) {
  const { dashboardId } = use(params)
  const id = parseInt(dashboardId, 10)
  const { data: dashboard, isLoading } = useDashboard(id)
  const { data: annotations } = useAnnotations(id)
  const updateDashboard = useUpdateDashboard()
  const createWidget = useCreateWidget()
  const updateWidget = useUpdateWidget()
  const deleteWidget = useDeleteWidget()
  const saveLayout = useSaveLayout()
  const [isEditing, setIsEditing] = useState(false)
  const [addWidgetOpen, setAddWidgetOpen] = useState(false)
  const [textboxOpen, setTextboxOpen] = useState(false)
  const [editingTextbox, setEditingTextbox] = useState<{ id: number; text: string } | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  // Applied dashboard-level parameter values, keyed by dashboard parameter
  // name. Starts empty rather than seeded with the defaults, because
  // widgetParameters already falls back to each query's own saved default for
  // anything not set here.
  const [dashboardValues, setDashboardValues] = useState<Record<string, unknown>>({})
  const qc = useQueryClient()
  const toast = useToast()
  // Always an array and never rejecting, so the vocabulary being down degrades
  // the add input to free text rather than taking tagging out.
  const tagSuggestions = useTagVocabulary().data
  // The array arrives whole from TagsControl, `domain:*` included, so a save
  // built from it cannot drop a domain hub.
  const saveTags = useOptimisticTags(['dashboard', id], (tags, options) =>
    updateDashboard.mutate({ id, tags }, options)
  )

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['query-result'] })
    qc.invalidateQueries({ queryKey: ['widget-data'] })
  }, [qc])

  // The controls to render above the grid, one per distinct dashboard
  // parameter, built from the mappings the add-widget dialog has been writing
  // all along.
  const dashboardParameters = useMemo(
    () => collectDashboardParameters(dashboard?.widgets ?? []),
    [dashboard]
  )

  // Collect existing dashboard-level parameter names from all widget mappings
  const existingDashboardParams = useMemo(() => {
    if (!dashboard) return []
    const params = new Set<string>()
    for (const w of dashboard.widgets) {
      const mappings = w.options.parameterMappings
      if (mappings && typeof mappings === 'object') {
        for (const [key, mapping] of Object.entries(mappings)) {
          const m = mapping as { type?: string; mapTo?: string }
          if (m.type === 'dashboard-add-new' || m.type === 'dashboard-map-to-existing') {
            params.add(m.mapTo ?? key)
          }
        }
      }
    }
    return [...params]
  }, [dashboard])

  // The same skeleton loading.tsx puts up for this route, so the segment
  // arriving and the dashboard arriving are one continuous wait rather than a
  // skeleton that blinks out into a line of grey text.
  if (isLoading) {
    return <PageLoading rows={4} label="Loading dashboard" />
  }

  if (!dashboard) {
    return (
      <PageContainer>
        <NoData message="Dashboard not found" />
      </PageContainer>
    )
  }

  // Tagging follows the same permission as every other dashboard write rather
  // than the Edit toggle. Edit mode is for arranging widgets and a label is not
  // part of a layout, so requiring a layout session to add one is why tagging a
  // dashboard was effectively hidden. `can_edit` is Redash's own `can_modify`,
  // which already answers yes for an admin.
  const canEdit = Boolean(dashboard.can_edit)

  const handleLayoutChange = (positions: { id: number; col: number; row: number; sizeX: number; sizeY: number }[]) => {
    const updatedWidgets = dashboard.widgets.map((w) => {
      const pos = positions.find((p) => p.id === w.id)
      if (!pos) return w
      return { ...w, options: { ...w.options, position: { col: pos.col, row: pos.row, sizeX: pos.sizeX, sizeY: pos.sizeY } } }
    })
    saveLayout.mutate({ dashboardId: id, widgets: updatedWidgets })
  }

  const handleAddWidget = (
    queryId: number,
    viz: { id: number; type: string; name: string; description: string; options: Record<string, unknown> },
    position: { col: number; row: number; sizeX: number; sizeY: number },
    paramMappings: ParameterMapping[]
  ) => {
    // Convert parameter mappings array to record
    const parameterMappings: Record<string, unknown> = {}
    for (const m of paramMappings) {
      parameterMappings[m.name] = {
        type: m.type,
        mapTo: m.mapTo,
        value: m.value,
        title: m.title,
      }
    }

    createWidget.mutate({
      dashboardId: id,
      visualization: { ...viz, query: { id: queryId } },
      width: 1,
      options: {
        position,
        ...(paramMappings.length > 0 ? { parameterMappings } : {}),
      },
    })
  }

  const handleAddTextbox = (text: string) => {
    if (editingTextbox) {
      const widget = dashboard.widgets.find((w) => w.id === editingTextbox.id)
      updateWidget.mutate({
        dashboardId: id,
        widgetId: editingTextbox.id,
        text,
        options: widget?.options ?? { position: { col: 0, row: 0, sizeX: 6, sizeY: 4 } },
      })
      setEditingTextbox(null)
    } else {
      const maxRow = dashboard.widgets.reduce((max, w) => Math.max(max, w.options.position.row + w.options.position.sizeY), 0)
      createWidget.mutate({
        dashboardId: id,
        text,
        width: 1,
        options: { position: { col: 0, row: maxRow, sizeX: 6, sizeY: 4 } },
      })
    }
  }

  // No confirm here, unlike deleting a visualization: this only appears inside
  // an explicit edit session, and a removed widget can be added straight back
  // from the same toolbar, so a prompt on each one would fight the arranging.
  // The failure path is another matter: the widget vanished from the grid
  // whatever the server said, so a refused delete looked exactly like an
  // accepted one until the page was reloaded.
  const handleRemoveWidget = (widgetId: number) => {
    deleteWidget.mutate(
      { dashboardId: id, widgetId },
      { onError: () => toast.error('Could not remove that widget. It is still on the dashboard.') }
    )
  }

  const handleEditWidget = (widget: typeof dashboard.widgets[0]) => {
    if (widget.text != null) {
      setEditingTextbox({ id: widget.id, text: widget.text })
      setTextboxOpen(true)
    }
  }

  return (
    <PageContainer>
      <div className="flex items-start justify-between mb-6">
        <div>
          {/* Without this the document outline starts at the widget h2s and
              the page has no heading of its own. */}
          {/* Starring belongs where you are when you decide a dashboard is
              worth coming back to, not only in the row on the list page. */}
          <div className="flex items-center gap-2">
            <h1 className="m-0">
              <EditInPlace
                value={dashboard.name}
                onSave={(name) => updateDashboard.mutate({ id, name })}
                className="font-display text-2xl font-medium"
              />
            </h1>
            <FavoritesControl
              type="dashboards"
              id={id}
              isFavorite={dashboard.is_favorite ?? false}
            />
          </div>
          <div className="flex items-center gap-3 mt-2">
            <TagsControl tags={dashboard.tags} editable={canEdit} onChange={saveTags} suggestions={tagSuggestions} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshRatePicker onRefresh={handleRefresh} />
          {isEditing ? (
            <>
              <Button variant="outline" onClick={() => setAddWidgetOpen(true)}>
                <Plus className="h-4 w-4" />
                Widget
              </Button>
              <Button variant="outline" onClick={() => { setEditingTextbox(null); setTextboxOpen(true) }}>
                <Type className="h-4 w-4" />
                Textbox
              </Button>
              <EditWithAiButton dashboardId={id} />
              <Button onClick={() => setIsEditing(false)}>
                <Save className="h-4 w-4" />
                Done Editing
              </Button>
              <IconButton
                tooltip="Exit editing"
                variant="outline"
                size="icon"
                onClick={() => setIsEditing(false)}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </>
          ) : (
            <DashboardViewActions
              dashboard={dashboard}
              onEdit={() => setIsEditing(true)}
              onShare={() => setShareOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Hidden while arranging the layout: in edit mode the widgets are being
          moved, not read, and a control that re-runs every one of them is noise
          there. */}
      {!isEditing && dashboardParameters.length > 0 && (
        <ParametersBar parameters={dashboardParameters} onChange={setDashboardValues} />
      )}

      <DashboardGrid
        widgets={dashboard.widgets}
        isEditing={isEditing}
        onLayoutChange={handleLayoutChange}
        onEditWidget={handleEditWidget}
        onRemoveWidget={handleRemoveWidget}
        annotations={annotations}
        dashboardValues={dashboardValues}
      />

      <AddWidgetDialog
        open={addWidgetOpen}
        onClose={() => setAddWidgetOpen(false)}
        existingWidgets={dashboard.widgets}
        existingDashboardParams={existingDashboardParams}
        onAdd={handleAddWidget}
      />

      <TextboxDialog
        open={textboxOpen}
        onClose={() => { setTextboxOpen(false); setEditingTextbox(null) }}
        initialText={editingTextbox?.text ?? ''}
        onSave={handleAddTextbox}
      />

      <ShareDashboardDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        dashboard={dashboard}
      />
    </PageContainer>
  )
}
