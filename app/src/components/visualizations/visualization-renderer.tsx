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
 * Stands in for a renderer whose code has not arrived yet.
 *
 * Sized to fill whatever pane it was given rather than to a guess: a fixed
 * height here would be a second opinion about how tall a widget is, and the one
 * that already exists (the grid item, the dialog pane, the slide) is the
 * correct one. min-h-24 is only so an unconstrained parent does not collapse it
 * to nothing and flash a zero-height box.
 *
 * Decorative, not announced. VisualizationProblems below is a role="status"
 * region in this same subtree, and a second one would put "loading" in
 * competition with the reason a visualization cannot draw. The surfaces that
 * mount this each announce their own not-ready state already (the dashboard
 * widget has one for its query), and what is being waited on here is a script
 * chunk, not an answer from a backend.
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
 * Dispatches through the registry rather than a switch. The switch used to be
 * the only place four types were mentioned at all, which is how they came to
 * render while being impossible to create.
 *
 * The lookup is deliberately not filtered by the instance allowlist: a widget
 * saved before an operator disabled its type must still draw, otherwise
 * turning a type off silently blanks existing dashboards.
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

  // Every renderer takes the same props now. Ones that do not use annotations
  // simply ignore them, which is cheaper than keeping a per-type call site.
  const { Renderer } = plugin
  const options = (visualization.options ?? {}) as Record<string, unknown>
  const problems = validateVisualization(visualization.type, options, data)

  // The theme boundary sits here rather than inside each renderer because this
  // is the one place every visualization passes through, core and plugin alike,
  // and because a renderer with three early returns would otherwise have to
  // wrap all three. For the default ('auto') it is a display:contents element,
  // so this is the same shape as the fragment it replaced.
  return (
    <WidgetThemeBoundary theme={readWidgetTheme(options)}>
      {/* Registered renderers are lazy (see lib/visualizations/lazy-components.ts),
          so this boundary is what every render surface gets for free by going
          through this component. It wraps the renderer ALONE: the problems list
          is derived from options and data with no code to fetch, and putting it
          inside would hide the reason a visualization cannot draw behind the
          load of the thing that cannot draw it.

          Keyed by type so switching type in the edit dialog remounts the
          boundary rather than reusing a resolved one, which is what stops the
          previous type's renderer staying on screen while the next one loads. */}
      <VisualizationProblems problems={problems} />
      <Suspense key={visualization.type} fallback={<RendererFallback />}>
        <Renderer visualization={visualization} data={data} annotations={annotations} />
      </Suspense>
    </WidgetThemeBoundary>
  )
}
