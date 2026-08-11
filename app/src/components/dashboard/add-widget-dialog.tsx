'use client'

import { useState, useCallback, useRef } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useQueries, useQueryById } from '@/hooks/use-queries'
import { cn } from '@/lib/utils'
import type { MockVisualization, MockDashboardWidget, ParameterValue } from '@/lib/mock-data'
import { calculateNewWidgetPosition, getDefaultSize } from './add-widget-layout'
import { AddWidgetSearch } from './add-widget-search'
import { AddWidgetVisualization } from './add-widget-visualization'
import { AddWidgetParamMapping } from './add-widget-param-mapping'

// ─── Parameter mapping types (mirrors Redash MappingType) ───────────────────

export type MappingType = 'dashboard-add-new' | 'dashboard-map-to-existing' | 'widget-level' | 'static-value'

export interface ParameterMapping {
  name: string
  type: MappingType
  mapTo: string
  value: ParameterValue
  title: string
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface AddWidgetDialogProps {
  open: boolean
  onClose: () => void
  existingWidgets: MockDashboardWidget[]
  existingDashboardParams: string[]
  onAdd: (
    queryId: number,
    visualization: { id: number; type: string; name: string; description: string; options: Record<string, unknown> },
    position: { col: number; row: number; sizeX: number; sizeY: number },
    parameterMappings: ParameterMapping[]
  ) => void
}

// ─── Steps ──────────────────────────────────────────────────────────────────

type Step = 'search' | 'visualization' | 'parameters'

export function AddWidgetDialog({ open, onClose, existingWidgets, existingDashboardParams, onAdd }: AddWidgetDialogProps) {
  const [step, setStep] = useState<Step>('search')
  const [search, setSearch] = useState('')
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(null)
  const [selectedVizId, setSelectedVizId] = useState<number | null>(null)
  const [parameterMappings, setParameterMappings] = useState<ParameterMapping[]>([])
  const idCounter = useRef(1000000)

  const { data: queriesData } = useQueries({ search: search || undefined })
  const { data: selectedQuery } = useQueryById(selectedQueryId ?? undefined)

  const queries = queriesData?.results ?? []

  const resetAndClose = useCallback(() => {
    setStep('search')
    setSearch('')
    setSelectedQueryId(null)
    setSelectedVizId(null)
    setParameterMappings([])
    onClose()
  }, [onClose])

  // ── Step 1: Select query ──

  const handleSelectQuery = useCallback((queryId: number) => {
    setSelectedQueryId(queryId)
    setSelectedVizId(null)
    setParameterMappings([])
    setStep('visualization')
  }, [])

  // ── Step 2: Select visualization ──

  const handleSelectVisualization = useCallback((viz: MockVisualization) => {
    if (selectedQueryId == null) return
    setSelectedVizId(viz.id)

    // Build parameter mappings from query params
    const queryParams = selectedQuery?.options.parameters ?? []
    if (queryParams.length > 0) {
      const mappings: ParameterMapping[] = queryParams.map((p) => ({
        name: p.name,
        type: existingDashboardParams.includes(p.name) ? 'dashboard-map-to-existing' : 'dashboard-add-new',
        mapTo: p.name,
        value: p.value,
        title: p.title || p.name,
      }))
      setParameterMappings(mappings)
      setStep('parameters')
    } else {
      // No params, add directly
      const size = getDefaultSize(viz.type)
      const position = calculateNewWidgetPosition(existingWidgets, size.sizeX, size.sizeY)
      idCounter.current += 1
      onAdd(
        selectedQueryId,
        { id: viz.id, type: viz.type, name: viz.name, description: viz.description, options: viz.options as Record<string, unknown> },
        { ...position, ...size },
        []
      )
      resetAndClose()
    }
  }, [selectedQuery, selectedQueryId, existingDashboardParams, existingWidgets, onAdd, resetAndClose])

  // ── Step 3: Confirm with parameter mappings ──

  const handleConfirm = useCallback(() => {
    if (!selectedQuery || selectedVizId == null || selectedQueryId == null) return
    const viz = selectedQuery.visualizations.find((v) => v.id === selectedVizId)
    if (!viz) return

    const size = getDefaultSize(viz.type)
    const position = calculateNewWidgetPosition(existingWidgets, size.sizeX, size.sizeY)
    onAdd(
      selectedQueryId,
      { id: viz.id, type: viz.type, name: viz.name, description: viz.description, options: viz.options as Record<string, unknown> },
      { ...position, ...size },
      parameterMappings
    )
    resetAndClose()
  }, [selectedQuery, selectedVizId, selectedQueryId, existingWidgets, parameterMappings, onAdd, resetAndClose])

  const updateMapping = useCallback((index: number, updates: Partial<ParameterMapping>) => {
    setParameterMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...updates } : m))
    )
  }, [])

  // ── Step indicator ──

  const stepNumber = step === 'search' ? 1 : step === 'visualization' ? 2 : 3
  const hasParams = (selectedQuery?.options.parameters ?? []).length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetAndClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-5 text-xs text-muted-foreground">
            <StepBadge num={1} label="Query" active={stepNumber >= 1} current={stepNumber === 1} />
            <ChevronRight className="h-3 w-3 text-border" aria-hidden="true" />
            <StepBadge num={2} label="Visualization" active={stepNumber >= 2} current={stepNumber === 2} />
            {hasParams && (
              <>
                <ChevronRight className="h-3 w-3 text-border" aria-hidden="true" />
                <StepBadge num={3} label="Parameters" active={stepNumber >= 3} current={stepNumber === 3} />
              </>
            )}
          </div>

          {/* Step 1: Search queries */}
          {step === 'search' && (
            <AddWidgetSearch
              search={search}
              onSearchChange={setSearch}
              queries={queries}
              onSelectQuery={handleSelectQuery}
            />
          )}

          {/* Step 2: Pick visualization */}
          {step === 'visualization' && selectedQuery && (
            <AddWidgetVisualization
              query={selectedQuery}
              onBack={() => { setStep('search'); setSelectedQueryId(null) }}
              onSelectVisualization={handleSelectVisualization}
            />
          )}

          {/* Step 3: Parameter mapping */}
          {step === 'parameters' && selectedQuery && (
            <AddWidgetParamMapping
              query={selectedQuery}
              parameterMappings={parameterMappings}
              existingDashboardParams={existingDashboardParams}
              onBack={() => setStep('visualization')}
              onUpdateMapping={updateMapping}
            />
          )}
        </div>
        {step === 'parameters' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep('visualization')}>
              Back
            </Button>
            <Button onClick={handleConfirm}>Add to Dashboard</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Step badge ─────────────────────────────────────────────────────────────

function StepBadge({ num, label, active, current }: { num: number; label: string; active: boolean; current: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors',
        current
          ? 'bg-primary text-primary-foreground'
          : active
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground'
      )}
    >
      {active && !current ? <Check className="h-3 w-3" /> : <span>{num}</span>}
      {label}
    </span>
  )
}
