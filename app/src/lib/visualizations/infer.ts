// A plugin's own guess at its options, for a result it can see.
//
// Two callers, and they are the two moments a visualization's options are first
// written: the edit dialog, when a type is picked, and the AI create flow, when
// a widget's visualization is saved for a query the service just wrote. Both
// used to be one line each, and the AI one simply did not have it, so a chart
// or heatmap it authored carried `{}` and relied on whatever the renderer
// happened to fall back to.
//
// `inferOptions` is optional on a plugin and every implementation of it refuses
// to overwrite what it is given, so this is safe to call on any type with any
// options, including a set an analyst has already edited.
import type { QueryResultData } from '@/lib/mock-data'
import { getVisualization } from './registry'

export function inferredVizOptions(
  type: string,
  options: Record<string, unknown>,
  data: QueryResultData
): Record<string, unknown> {
  return getVisualization(type)?.inferOptions?.(options, data) ?? options
}
