'use client'

import { useMemo, useCallback } from 'react'
import { ResponsiveGridLayout, useContainerWidth, type LayoutItem, type Layout } from 'react-grid-layout'
import type { MockDashboardWidget } from '@/lib/mock-data'
import type { Annotation } from '@/types/annotation'
import { Button } from '@/components/ui/button'
import { VisualizationWidget } from './visualization-widget'
import { TextboxWidget } from './textbox-widget'
import 'react-grid-layout/css/styles.css'

interface DashboardGridProps {
  widgets: MockDashboardWidget[]
  isEditing: boolean
  onLayoutChange?: (widgetPositions: { id: number; col: number; row: number; sizeX: number; sizeY: number }[]) => void
  onEditWidget?: (widget: MockDashboardWidget) => void
  onRemoveWidget?: (widgetId: number) => void
  annotations?: Annotation[]
  /** Dashboard-level parameter values, passed through to each widget. */
  dashboardValues?: Record<string, unknown>
  /** Rendered through a public share token; passed through to each widget. */
  isPublic?: boolean
}

export function DashboardGrid({ widgets, isEditing, onLayoutChange, onEditWidget, onRemoveWidget, annotations, dashboardValues, isPublic = false }: DashboardGridProps) {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 })

  const layout = useMemo<LayoutItem[]>(
    () =>
      widgets.map((w) => ({
        i: String(w.id),
        x: w.options.position.col,
        y: w.options.position.row,
        w: w.options.position.sizeX,
        h: w.options.position.sizeY,
        minW: 1,
        minH: 2,
      })),
    [widgets]
  )

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (!onLayoutChange) return
      const positions = newLayout.map((l) => ({
        id: Number(l.i),
        col: l.x,
        row: l.y,
        sizeX: l.w,
        sizeY: l.h,
      }))
      onLayoutChange(positions)
    },
    [onLayoutChange]
  )

  if (widgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg text-muted-foreground mb-4">
          This dashboard is empty
        </p>
        {isEditing && <Button>Add Widget</Button>}
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      {width > 0 && (
        <ResponsiveGridLayout
          className="react-grid-layout"
          layouts={{ lg: layout }}
          breakpoints={{ lg: 800, sm: 0 }}
          cols={{ lg: 6, sm: 1 }}
          rowHeight={50}
          margin={[15, 15] as const}
          width={width}
          dragConfig={{ enabled: isEditing, handle: '.widget-drag-handle' }}
          resizeConfig={{ enabled: isEditing }}
          onLayoutChange={handleLayoutChange}
        >
          {widgets.map((widget) => (
            <div key={String(widget.id)} className="min-h-0">
              {widget.text != null ? (
                <TextboxWidget
                  text={widget.text}
                  isEditing={isEditing}
                  onEdit={() => onEditWidget?.(widget)}
                  onRemove={() => onRemoveWidget?.(widget.id)}
                />
              ) : widget.visualization ? (
                <VisualizationWidget
                  widget={widget}
                  isEditing={isEditing}
                  onRemove={() => onRemoveWidget?.(widget.id)}
                  annotations={annotations}
                  dashboardValues={dashboardValues}
                  isPublic={isPublic}
                />
              ) : null}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  )
}
