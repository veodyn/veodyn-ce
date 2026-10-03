'use client'

import { Suspense } from 'react'
import type { PlacedAnnotation } from '../../lib/annotation-overlay'
import type { MockVisualization, QueryResultData } from '../../types/viz-data'
import { getVisualization, validateVisualization } from '../../lib/visualizations'
import { readWidgetTheme } from '../../lib/widget-theme'
import { WidgetThemeBoundary } from '../theme/widget-theme-boundary'
import { VisualizationProblems } from './visualization-problems'

interface VisualizationRendererProps {
  visualization: MockVisualization
  data: QueryResultData
  annotations?: PlacedAnnotation[]
  onOptionsChange?: (options: Record<string, unknown>) => void
}

function RendererFallback() {
  return (
    <div
      aria-hidden="true"
      className="h-full min-h-24 w-full rounded-md bg-muted motion-safe:animate-pulse"
    />
  )
}

export function VisualizationRenderer({
  visualization,
  data,
  annotations,
  onOptionsChange,
}: VisualizationRendererProps) {
  const plugin = getVisualization(visualization.type)

  if (!plugin) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Unsupported visualization type: {visualization.type}
      </div>
    )
  }

  const { Renderer } = plugin
  const options = (visualization.options ?? {}) as Record<string, unknown>
  const problems = validateVisualization(visualization.type, options, data)

  return (
    <WidgetThemeBoundary theme={readWidgetTheme(options)} visualizationType={visualization.type}>
      <VisualizationProblems problems={problems} />
      <Suspense key={visualization.type} fallback={<RendererFallback />}>
        <Renderer
          visualization={visualization}
          data={data}
          annotations={annotations}
          onOptionsChange={onOptionsChange}
        />
      </Suspense>
    </WidgetThemeBoundary>
  )
}
