'use client'

import { useState, useMemo, useId } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VisualizationRenderer } from './visualization-renderer'
import { useConfig } from '@/components/config/config-provider'
import {
  getVisualization,
  inferredVizOptions as withInferredMapping,
  validateVisualization,
  visualizationData,
} from '@/lib/visualizations'
import { VisualizationEditorSlot } from './visualization-editor-slot'
import { VisualizationProblems } from './visualization-problems'
import { VisualizationTypeLabel } from './visualization-type-label'
import { visibleVisualizations } from '@/lib/viz-choices'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'

// withInferredMapping is `inferredVizOptions`, aliased because that is what it
// does here: a chart opened with `columnMapping: {}`, which is what its default
// options carry, showed every column as '-- unused --'. That was never true, the
// renderer falls back to positional inference, so the preview drew a chart the
// editor described as unconfigured. Worse, the first select the analyst touched
// wrote a one-role mapping, which took the fallback away and left a y with no x.
// Seeding it means the editor says what the preview is doing, and that touching
// one row edits a whole mapping rather than creating a broken one.
//
// The plugin, not this dialog, decides what to seed and refuses to overwrite a
// mapping already saved. The AI create flow now calls the same function, which
// is why it stopped being a local.

interface EditVisualizationDialogProps {
  open: boolean
  onClose: () => void
  visualization?: MockVisualization
  data: QueryResultData
  onSave: (viz: { type: string; name: string; options: Record<string, unknown> }) => void
  /**
   * One line under the title, for a caller where what is being edited is not
   * obvious from where the dialog was opened. The query editor needs none: the
   * visualization is the tab you are looking at. A dashboard widget does,
   * because a visualization belongs to its query, not to the dashboard, and the
   * saved options are drawn by every dashboard and report using it.
   */
  note?: string
}

export function EditVisualizationDialog({
  open,
  onClose,
  visualization,
  data,
  onSave,
  note,
}: EditVisualizationDialogProps) {
  const isNew = !visualization
  const typeId = useId()
  const nameId = useId()
  // Instance visibility, which governs what can be CREATED: the allowlist, and
  // the types this deployment keeps out of an analyst's way. A new
  // visualization starts on the first type this instance offers rather than a
  // hardcoded TABLE, so an instance that turned the table off does not open its
  // New Visualization dialog on one.
  const { visualizations } = useConfig()
  const offered = visibleVisualizations(visualizations)
  // No TABLE fallback. An allowlist that names only types this build does not
  // register leaves `offered` empty, and falling back would let the dialog
  // create the one type the instance was most explicit about not offering.
  // Empty means there is nothing to create, handled at the footer.
  const initialType = visualization?.type || offered[0]?.type || ''
  const [vizType, setVizType] = useState(initialType)
  const [name, setName] = useState(visualization?.name || '')
  // A new visualization starts from its type's defaultOptions. Starting from
  // {} skipped them: defaults only ever reached a visualization whose type had
  // been changed at least once, so a CHOROPLETH created directly arrived
  // without the targetField that lets it match a region at all. Spread so a
  // later edit cannot write through into the plugin's own object.
  const [options, setOptions] = useState<Record<string, unknown>>(() =>
    withInferredMapping(
      initialType,
      visualization
        ? ((visualization.options as Record<string, unknown>) ?? {})
        : { ...(getVisualization(initialType)?.defaultOptions ?? {}) },
      data
    )
  )

  // Editing an existing visualization of a type an operator has since disabled
  // keeps that type in the list. Disabling controls what can be created, not
  // what can be read, and a select whose value names no option shows an empty
  // trigger for a visualization that is drawing fine beside it.
  //
  // `getVisualization` is called again rather than hoisted into a shared
  // `current`: putting the plugin object in an array literal makes the React
  // Compiler treat it as mutable, which then blocks the preview memo below
  // (react-hooks/preserve-manual-memoization) for a value nothing mutates.
  const offeredHasType = offered.some((plugin) => plugin.type === vizType)
  const savedPlugin = offeredHasType ? undefined : getVisualization(vizType)
  const typeOptions = savedPlugin ? [...offered, savedPlugin] : offered

  const effectiveName = name || getVisualization(vizType)?.displayName || vizType

  const previewViz = useMemo<MockVisualization>(
    () => ({
      id: visualization?.id || 0,
      type: vizType,
      name: effectiveName,
      description: '',
      options,
      created_at: '',
      updated_at: '',
    }),
    [visualization?.id, vizType, effectiveName, options]
  )

  // Null falls through to the problems list and "Run the query to see preview".
  // A type that draws from something other than these rows previews straight
  // away, which is the only way its author can see what they are configuring.
  const previewData = visualizationData(vizType, data, { requireRows: true })

  const handleSave = () => {
    onSave({ type: vizType, name: effectiveName, options })
    onClose()
  }

  const handleTypeChange = (type: string) => {
    setVizType(type)
    const vt = getVisualization(type)
    setOptions(withInferredMapping(type, vt?.defaultOptions || {}, data))
    if (!name || name === getVisualization(vizType)?.displayName) {
      setName(vt?.displayName || '')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        size="2xl"
        // A workspace dialog: the preview is the point, and both panes want to
        // fill the dialog and scroll internally rather than growing it. Without
        // this the panel's height is indefinite, so the preview pane's own
        // percentage bounds resolve to nothing and whatever it holds overflows
        // the dialog body instead of scrolling inside its own pane.
        fill
      >
        <DialogHeader>
          <DialogTitle>{isNew ? 'New Visualization' : `Edit ${effectiveName}`}</DialogTitle>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </DialogHeader>
        {/* Stands in for the wrapper's own scrolling body div: DialogContent has
            no such region of its own, only a header/body/footer stack sharing
            one flex column. min-h-0 alongside flex-1: a flex item's automatic
            minimum size is its content, so without it this region refuses to
            shrink below its children and the panel grows past the height
            `fill` just set on it. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* A set height, not a min height. Each type renders a different set of
              editors (a chart brings two axis boxes, reference lines and two
              toggles; a counter brings a handful of fields), so with the column
              free to grow the dialog changed size on every type switch and the
              whole modal jumped under the pointer.

              h-full rather than a calc restating the wrapper's cap: `fill` above
              makes the panel's height definite, so this resolves against it and
              stays correct if that height ever changes. */}
          <div className="flex h-full min-h-0 gap-6">
            {/* Left: Editor. `pr-3` keeps the scrollbar inside the column instead
                of drawing it hard against the preview panel next door, and the
                stable gutter stops the fields shifting sideways the moment the
                options grow tall enough to scroll. */}
            <div className="w-80 shrink-0 space-y-4 overflow-y-auto pr-3 [scrollbar-gutter:stable]">
              {/* Both labels are tied to the control they name. Left loose they
                  were text sitting above a widget: a screen reader announced the
                  type select as an unnamed button, and the name field as an unnamed
                  text box. A `label` may target a button, so the select's trigger
                  takes the association directly. */}
              <div>
                <Label htmlFor={typeId} className="mb-1 block">Type</Label>
                <Select value={vizType} onValueChange={(v) => handleTypeChange(v ?? vizType)} disabled={!isNew}>
                  <SelectTrigger id={typeId} className="w-full h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((vt) => (
                      <SelectItem key={vt.type} value={vt.type}>
                        <VisualizationTypeLabel type={vt.type} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={nameId} className="mb-1 block">Name</Label>
                <Input
                  id={nameId}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8"
                  placeholder={getVisualization(vizType)?.displayName}
                />
              </div>
              <div className="border-t pt-4">
                <VisualizationEditorSlot
                  type={vizType}
                  options={options}
                  data={data}
                  onChange={setOptions}
                />
              </div>
            </div>

            {/* Right: Preview. A column so the header keeps its height and the
                body takes the rest; the row above owns the height, so the preview
                follows it instead of setting its own.

                overflow-auto, not overflow-hidden. The renderer keeps an absolute
                floor of its own (GRID_MIN_HEIGHT), so below roughly a 465px
                viewport this column cannot fit what it holds however well the
                heights above it are wired. hidden made that Important B's failure
                all over again at a smaller size: silently clipped, with the legend
                unreachable and no scrollbar to say so. auto degrades the way
                heatmap-grid-chrome.ts states the rule for the renderer itself, by
                handing the overflow back as a scrollbar. No floor is added back:
                a min-height that yields when there is no room is not expressible. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-lg border bg-card">
              <div className="shrink-0 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                Preview
              </div>
              {/* The preview is the reason to open this dialog, so it gets all the
                  room the panel can spare. This used to be
                  `max-h-[calc(70vh-2rem)]`, a literal restatement of the dialog
                  body's own cap that had to be kept in step with it by hand and
                  left the pane's height indefinite either way. flex-1 against the
                  dialog's now-definite height replaces both the magic number and
                  the coupling. min-h keeps the pane from collapsing when the
                  options column is short, which flex-1 against a definite parent
                  now does on its own.

                  No floor, and the measurement that settled it was taken while
                  the parent column was still `overflow-hidden`, so an unhonourable
                  floor was silently CLIPPED rather than handed back. With
                  `min-h-[420px]` in place: 103px of the pane cut off at a 600px
                  viewport and 52px at 660, with the legend and the bottom of the
                  grid unreachable and nothing on screen to say so. It cleared its
                  space by 1px at 720, which is the only reason a check at the
                  default viewport looked fine. The column is `overflow-auto` now
                  (see above), so that residual degrades to a scrollbar instead of
                  a clip, but the floor still does not come back: a min-height that
                  yields when there is no room is not expressible. */}
              <div className="flex-1 overflow-auto">
                {previewData ? (
                  <VisualizationRenderer visualization={previewViz} data={previewData} />
                ) : (
                  <>
                    {/* A result with columns but no rows still has everything
                        the mapping is checked against, and this dialog is
                        where the mapping gets fixed. Withholding the problems
                        until a row exists hid them at the one moment they were
                        most actionable. */}
                    <VisualizationProblems problems={validateVisualization(vizType, options, data)} />
                    <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                      Run the query to see preview
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {/* Nothing to create when the allowlist leaves no type offered, and
              a Save that writes a disabled type is worse than a dead button. */}
          <Button onClick={handleSave} disabled={!vizType}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
