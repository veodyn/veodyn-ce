'use client'

import { useMemo } from 'react'
import { VisualizationRenderer } from '@veodyn/viz/components/visualizations/visualization-renderer'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { getVisualization, inferredVizOptions } from '@veodyn/viz'
import { visualizationData } from '@veodyn/viz/lib/visualizations/data-gate'
import { sanitizedVizOptions } from '@/lib/chat/viz-options'
import { resolveVizChoice } from '@/lib/viz-choices'

interface ResultViewProps {
  data: QueryResultData
  vizChoiceId: string
  vizOptions?: Record<string, unknown>
  visualization?: MockVisualization | null
  className?: string
}

export function chatVisualization(
  vizChoiceId: string,
  data: QueryResultData,
  vizOptions?: Record<string, unknown>
): MockVisualization {
  const choice = resolveVizChoice(vizChoiceId)
  const defaults = getVisualization(choice.type)?.defaultOptions ?? {}
  const authored = sanitizedVizOptions(choice.type, vizOptions)
  return {
    id: -1,
    type: choice.type,
    name: choice.label,
    description: '',
    options: inferredVizOptions(choice.type, { ...defaults, ...choice.options, ...authored }, data),
    created_at: '',
    updated_at: '',
  }
}

export function ResultView({ data, vizChoiceId, vizOptions, visualization: saved, className }: ResultViewProps) {
  const inferred = useMemo(() => chatVisualization(vizChoiceId, data, vizOptions), [vizChoiceId, data, vizOptions])
  const visualization = saved ?? inferred
  const drawable = visualizationData(visualization.type, data, { requireRows: true })
  return (
    <div className={cn('h-72 min-h-0 overflow-auto rounded-md border bg-background', className)}>
      {drawable ? (
        <VisualizationRenderer visualization={visualization} data={drawable} />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">The query returned no rows.</p>
      )}
    </div>
  )
}
