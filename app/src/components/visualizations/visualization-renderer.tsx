'use client'

import { Suspense } from 'react'
import type { PlacedAnnotation } from '@/lib/annotation-overlay'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { getVisualization, validateVisualization } from '@/lib/visualizations'
import { readWidgetTheme } from '@/lib/widget-theme'
import { WidgetThemeBoundary } from '@/components/theme/widget-theme-boundary'
import { VisualizationProblems } from './visualization-problems'

interface VisualizationRendererProps {
  visualization: MockVisualization
  data: QueryResultData
  annotations?: PlacedAnnotation[]
}

/**
 * Stands in for a renderer whose code has not arrived yet. Fills the pane it was
 * given rather than guessing a height; min-h-24 only stops an unconstrained
 * parent collapsing it to a zero-height box.
 *
 * aria-hidden, because VisualizationProblems below is a role="status" region in
 * this same subtree and a second one would put "loading" in competition with the
 * reason a visualization cannot draw.
 */
function RendererFallback() {
  return (
    <div
      aria-hidden="true"
      className="h-full min-h-24 w-full rounded-md bg-muted motion-safe:animate-pulse"
    />
  )
}

/**
 * Dispatches through the registry rather than a switch. The lookup is not
 * filtered by the instance allowlist: a widget saved before an operator disabled
 * its type must still draw, or turning a type off blanks existing dashboards.
 */
export function VisualizationRenderer({
  visualization,
  data,
  annotations,
}: VisualizationRendererProps) {
  const plugin = getVisualization(visualization.type)

  if (!plugin) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Unsupported visualization type: {visualization.type}
      </div>
    )
  }

  // Every renderer takes the same props; ones that do not use annotations ignore
  // them, which is cheaper than a per-type call site.
  const { Renderer } = plugin
  const options = (visualization.options ?? {}) as Record<string, unknown>
  const problems = validateVisualization(visualization.type, options, data)

  // The theme boundary sits here because this is the one place every
  // visualization passes through, core and plugin alike. For the default
  // ('auto') it renders a display:contents element.
  return (
    <WidgetThemeBoundary theme={readWidgetTheme(options)}>
      {/* Registered renderers are lazy (lib/visualizations/lazy-components.ts).
          The boundary wraps the renderer ALONE, so the problems list is not
          hidden behind the load of the thing that cannot draw. Keyed by type so
          switching type in the edit dialog remounts it rather than leaving the
          previous renderer on screen while the next one loads. */}
      <VisualizationProblems problems={problems} />
      <Suspense key={visualization.type} fallback={<RendererFallback />}>
        <Renderer visualization={visualization} data={data} annotations={annotations} />
      </Suspense>
    </WidgetThemeBoundary>
  )
}
