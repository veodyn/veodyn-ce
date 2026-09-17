'use client'

import { useMemo } from 'react'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { getVisualization, inferredVizOptions } from '@/lib/visualizations'
import { resolveVizChoice } from '@/lib/viz-choices'

interface ResultViewProps {
  data: QueryResultData
  vizChoiceId: string
  className?: string
}

export function chatVisualization(vizChoiceId: string, data: QueryResultData): MockVisualization {
  const choice = resolveVizChoice(vizChoiceId)
  const defaults = getVisualization(choice.type)?.defaultOptions ?? {}
  return {
    id: -1,
    type: choice.type,
    name: choice.label,
    description: '',
    options: inferredVizOptions(choice.type, { ...defaults, ...choice.options }, data),
    created_at: '',
    updated_at: '',
  }
}

export function ResultView({ data, vizChoiceId, className }: ResultViewProps) {
  const visualization = useMemo(() => chatVisualization(vizChoiceId, data), [vizChoiceId, data])
  return (
    <div className={cn('h-72 min-h-0 overflow-auto rounded-md border bg-background', className)}>
      <VisualizationRenderer visualization={visualization} data={data} />
    </div>
  )
}
