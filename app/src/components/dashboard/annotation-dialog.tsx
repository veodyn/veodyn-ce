'use client'

import { useId, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { useAiEnabled } from '@/hooks/use-ai'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAnnotations, useCreateAnnotation, useDeleteAnnotation } from '@/hooks/use-annotations'
import { annotationDraftError } from '@/lib/annotation-validation'
import { useFormats } from '@/hooks/use-formats'
import { Slot } from '@/features/slots'

interface AnnotationDialogProps {
  open: boolean
  onClose: () => void
  dashboardId: number
  // The widget the dialog was opened from. Null means there is no widget to
  // pin to (a dashboard-level entry point), so the "pin" toggle is hidden and
  // every annotation created here is dashboard-wide.
  widgetId: number | null
}

export function AnnotationDialog({ open, onClose, dashboardId, widgetId }: AnnotationDialogProps) {
  const pinnedId = useId()
  const labelId = useId()
  const startId = useId()
  const endId = useId()
  const sourceId = useId()
  const formats = useFormats()
  const aiEnabled = useAiEnabled()
  const { data: annotations } = useAnnotations(dashboardId)
  const createAnnotation = useCreateAnnotation()
  const deleteAnnotation = useDeleteAnnotation()

  const [label, setLabel] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [source, setSource] = useState('manual')
  const [pinned, setPinned] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setLabel('')
    setStart('')
    setEnd('')
    setSource('manual')
    setPinned(false)
    setError(null)
  }

  const handleSubmit = () => {
    const trimmedLabel = label.trim()
    // One rule, shared with the AI suggestion path (src/lib/annotation-validation.ts),
    // so an AI draft cannot enter through a gap this form would have closed.
    const problem = annotationDraftError({ label, start, end })
    if (problem !== null) {
      setError(problem)
      return
    }
    createAnnotation.mutate(
      {
        dashboard_id: dashboardId,
        widget_id: pinned && widgetId != null ? widgetId : null,
        start,
        end: end.trim() ? end : null,
        label: trimmedLabel,
        source: source.trim() || 'manual',
      },
      {
        // Clearing on success only. The reset used to run the moment the
        // mutation was fired, so a rejected write emptied the form exactly the
        // way an accepted one did and the user was told nothing either way.
        // Keeping the draft is also what makes the error actionable: there is
        // something left to retry.
        onSuccess: () => resetForm(),
        onError: (err) =>
          setError(
            `This annotation was not saved. ${err instanceof Error ? err.message : 'The request was refused.'}`
          ),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Annotations</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto">
          <div className="space-y-3">
            <div>
              <Label htmlFor={labelId} className="mb-1 block">
                Label
              </Label>
              <Input
                id={labelId}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="What happened"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={startId} className="mb-1 block">
                  Start (UTC)
                </Label>
                <Input
                  id={startId}
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={endId} className="mb-1 block">
                  End (UTC, optional)
                </Label>
                <Input
                  id={endId}
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Times are UTC, matching the chart axis.</p>
            <div>
              <Label htmlFor={sourceId} className="mb-1 block">
                Source
              </Label>
              <Input id={sourceId} value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            {widgetId != null && (
              <div className="flex items-center gap-2 text-sm">
                <Checkbox id={pinnedId} checked={pinned} onCheckedChange={setPinned} />
                <Label htmlFor={pinnedId} className="cursor-pointer">
                  Pin to this widget only
                </Label>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* Annotating a dashboard is community; having a model propose the
              annotations is not. The form above, the validation it shares with
              the accept path, and the list below all stay here, and the panel
              that drafts suggestions arrives through the registry. The
              aiEnabled gate stays too: it decides whether this instance offers
              AI at all, which is a separate question from whether this build
              has the feature that answers. */}
          {aiEnabled ? (
            <Slot
              id="dashboard.annotationSuggest"
              props={{ dashboardId, widgetId }}
              fallback={null}
            />
          ) : null}

          <div className="border-t pt-3">
            <p className="text-sm font-medium mb-2">Existing annotations</p>
            {annotations && annotations.length > 0 ? (
              <ul className="space-y-2">
                {annotations.map((annotation) => (
                  <li key={annotation.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{annotation.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {formats.dateTime(annotation.start)}
                        {annotation.end ? ` to ${formats.dateTime(annotation.end)}` : ''}
                        {' · '}
                        {annotation.widget_id != null ? `Widget #${annotation.widget_id}` : 'All widgets'}
                      </p>
                    </div>
                    <IconButton
                      tooltip="Delete annotation"
                      aria-label={`Delete annotation ${annotation.label}`}
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => deleteAnnotation.mutate(annotation.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No annotations yet.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleSubmit}>Add annotation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
