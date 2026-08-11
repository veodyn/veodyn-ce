'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { PlacedAnnotation } from '@/lib/annotation-overlay'

interface ExpandedWidgetDialogProps {
  open: boolean
  onClose: () => void
  title: string
  visualization: MockVisualization
  data: QueryResultData
  annotations?: PlacedAnnotation[]
}

export function ExpandedWidgetDialog({
  open,
  onClose,
  title,
  visualization,
  data,
  annotations,
}: ExpandedWidgetDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {/* `full` and `fill` fix two different axes of the same complaint, and this
          dialog needs both.

          `full`, not `xl`: at max-w-4xl this dialog was 896px, so expanding a
          widget on a wide dashboard handed back something NARROWER than the widget
          itself.

          `fill`: this dialog exists to show one visualization large. Without a
          definite panel height the renderer cannot bound itself to the dialog, so
          it falls back to its own viewport cap, overflows the dialog body, and the
          body scrolls instead: for a heatmap that carries the sticky header band
          out of view, which is the whole thing the band is for. */}
      <DialogContent size="full" fill>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* Stands in for the wrapper's own scrolling body div: DialogContent has
            no such region of its own, only a header/body stack sharing one flex
            column. min-h-0 alongside flex-1: a flex item's automatic minimum size
            is its content, so without it this region refuses to shrink below its
            children and the panel grows past the height `fill` just set on it. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* h-full, and neither a floor nor a calc. The old
              `h-[calc(70vh-2rem)]` restated the wrapper's own max-height by hand
              and had to be kept in step with it; under `fill` the panel's height is
              definite, so h-full simply resolves against it.

              `min-h-[500px]` was a floor for the old auto-height dialog. Under a
              definite panel it becomes an absolute MINIMUM the body cannot shrink
              below: the body's content box is 0.85vh less the header and its own
              padding, so 500px stopped fitting below roughly a 698px viewport and
              the body started scrolling again. Measured 51px of overflow at 660 (a
              1366x768 laptop) and 80px at 600, carrying the sticky header band away
              exactly as before `fill` existed. */}
          <div className="h-full">
            <VisualizationRenderer visualization={visualization} data={data} annotations={annotations} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
