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

interface EditVisualizationDialogProps {
  open: boolean
  onClose: () => void
  visualization?: MockVisualization
  data: QueryResultData
  onSave: (viz: { type: string; name: string; options: Record<string, unknown> }) => void
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
  const { visualizations } = useConfig()
  const offered = visibleVisualizations(visualizations)
  const initialType = visualization?.type || offered[0]?.type || ''
  const [vizType, setVizType] = useState(initialType)
  const [name, setName] = useState(visualization?.name || '')
  const [options, setOptions] = useState<Record<string, unknown>>(() =>
    withInferredMapping(
      initialType,
      visualization
        ? ((visualization.options as Record<string, unknown>) ?? {})
        : { ...(getVisualization(initialType)?.defaultOptions ?? {}) },
      data
    )
  )

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
        fill
      >
        <DialogHeader>
          <DialogTitle>{isNew ? 'New Visualization' : `Edit ${effectiveName}`}</DialogTitle>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex h-full min-h-0 gap-6">
            <div className="w-80 shrink-0 space-y-4 overflow-y-auto pr-3 [scrollbar-gutter:stable]">
              <div>
                <Label htmlFor={typeId} className="mb-1 block" required>Type</Label>
                <Select
                  value={vizType}
                  onValueChange={(v) => handleTypeChange(v ?? vizType)}
                  disabled={!isNew}
                  required
                >
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

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-lg border bg-card">
              <div className="shrink-0 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                Preview
              </div>
              <div className="flex-1 overflow-auto">
                {previewData ? (
                  <VisualizationRenderer
                    visualization={previewViz}
                    data={previewData}
                    onOptionsChange={setOptions}
                  />
                ) : (
                  <>
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
          <Button onClick={handleSave} disabled={!vizType}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
