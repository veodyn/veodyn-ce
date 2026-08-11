// Pure overlay logic for placing dashboard annotations on a time-series
// chart. The chart's x-axis is categorical (see line-area-chart.tsx), so a
// ReferenceLine/ReferenceArea only lands when its x prop equals an existing
// x category value in chartData. Annotations carry an arbitrary ISO
// timestamp, so it must be snapped to the nearest x value that is actually
// present in the widget's data before recharts can place it.

import { parseDateValue } from '@/lib/chart-format'
import type { Annotation } from '@/types/annotation'

export interface PlacedAnnotation {
  id: number
  label: string
  x: unknown
  x2: unknown | null
}

// Snaps an ISO timestamp to the nearest x value present in xValues, parsing
// both sides through parseDateValue for a comparable epoch. Returns null
// when the annotation, the x list, or all of xValues fail to parse, or when
// the annotation time falls outside [min(xValues), max(xValues)]: an
// annotation whose time isn't covered by the widget's x-axis range has
// nowhere valid to snap.
export function snapToNearestX(iso: string, xValues: unknown[]): unknown | null {
  const targetEpoch = parseDateValue(iso)
  if (targetEpoch == null) return null

  const parsed = xValues
    .map((x) => ({ x, epoch: parseDateValue(x) }))
    .filter((candidate): candidate is { x: unknown; epoch: number } => candidate.epoch != null)
  if (parsed.length === 0) return null

  const epochs = parsed.map((candidate) => candidate.epoch)
  const minEpoch = Math.min(...epochs)
  const maxEpoch = Math.max(...epochs)
  if (targetEpoch < minEpoch || targetEpoch > maxEpoch) return null

  let nearest = parsed[0]
  let nearestDistance = Math.abs(nearest.epoch - targetEpoch)
  for (const candidate of parsed) {
    const distance = Math.abs(candidate.epoch - targetEpoch)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest.x
}

// Filters a dashboard's annotations down to the ones relevant to a single
// widget's chart, snapping each to the widget's own x-axis values. An
// annotation applies to a widget when it is pinned to it (widget_id equal)
// or applies to every time-series widget on the dashboard (widget_id null).
// Annotations whose start doesn't snap (out of this widget's x-range) are
// dropped. A range annotation (non-null end) is only kept when BOTH start
// and end snap to a real x value; if either one falls outside the widget's
// x-range the whole annotation is dropped, matching the "out-of-range
// annotations render nothing" rule. Letting a range degrade into a point
// when only its end is out of range would misrepresent it as a single-time
// marker instead of the range it actually is.
export function annotationsForWidget(
  annotations: Annotation[],
  widgetId: number,
  xValues: unknown[],
): PlacedAnnotation[] {
  const placed: PlacedAnnotation[] = []
  for (const annotation of annotations) {
    if (annotation.widget_id !== widgetId && annotation.widget_id !== null) continue
    const x = snapToNearestX(annotation.start, xValues)
    if (x == null) continue
    if (annotation.end == null) {
      placed.push({ id: annotation.id, label: annotation.label, x, x2: null })
      continue
    }
    const x2 = snapToNearestX(annotation.end, xValues)
    if (x2 == null) continue
    placed.push({ id: annotation.id, label: annotation.label, x, x2 })
  }
  return placed
}
