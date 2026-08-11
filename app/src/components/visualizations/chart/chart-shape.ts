// Which chart Redash stored, and which chart this app can draw. They are not
// the same list, and the gap used to be invisible.
import type { RedashChartOptions } from '@/services/redash/types'

/** The shapes this app can actually draw. Not the list Redash can store. */
export type ChartShape = 'line' | 'bar' | 'area' | 'pie' | 'scatter'

/**
 * What a stored `globalSeriesType` draws as.
 *
 * Redash stores eight values (see its ChartTypeSelect) and this app drew five,
 * with everything else falling through a `default:` to a line chart. Since
 * Redash's default is `column`, a bar chart authored in Redash's own UI came out
 * here as a line, and nothing said so.
 *
 * Mapping happens here, on the way in, and never on the way out: rewriting the
 * stored option instead would save `bar` back to Redash on the next edit,
 * silently changing an analyst's chart and leaving Redash's own dropdown blank,
 * because `bar` is not a value it knows.
 */
const SHAPE_BY_STORED_TYPE: Record<string, ChartShape> = {
  line: 'line',
  area: 'area',
  pie: 'pie',
  scatter: 'scatter',
  // This app's own spelling, written by its own editor.
  bar: 'bar',
  // Redash's spelling for the same vertical bar chart, and what it writes when
  // nobody touches the type dropdown.
  column: 'bar',
  // A bubble chart is a scatter with a size channel, and ScatterChart draws
  // both: the column in Redash's `size` role becomes a ZAxis, so every mark's
  // area carries it. Faithful with a size column mapped and faithful without
  // one, so the SHAPE is never the problem with a bubble. A size column the
  // query no longer returns still is, and that one is reported by
  // missingMappedColumns, which has the result to check it against.
  bubble: 'scatter',
}

/**
 * Shapes Redash can store that this app knowingly does not draw, and why.
 *
 * `box` and `heatmap` exist here as their own visualization types (BOXPLOT,
 * HEATMAP) rather than as chart shapes, so leaving them undrawn is a deliberate
 * deferral rather than an oversight.
 */
const DEFERRED_SHAPES: Record<string, string> = {
  box: 'This chart is stored as a box plot, which is not drawn as a chart shape here. Use the Box Plot visualization type instead.',
  heatmap:
    'This chart is stored as a heatmap, which is not drawn as a chart shape here. Use the Heatmap visualization type instead.',
}

/**
 * The shape to draw for a stored type. Falls back to line for anything
 * unrecognised, which is the historical behaviour; `chartShapeProblems` is what
 * keeps that fallback from being silent.
 */
export function resolveChartShape(storedType: string | undefined): ChartShape {
  if (storedType == null || storedType === '') return 'line'
  return SHAPE_BY_STORED_TYPE[storedType] ?? 'line'
}

/**
 * Why this chart is not the chart that was stored. Empty when it is.
 *
 * Surfaced through the CHART plugin's `validate`, which renders as a note above
 * the visualization rather than in place of it, so the reader gets the closest
 * honest drawing and the caveat at the same time.
 */
export function chartShapeProblems(options: RedashChartOptions): string[] {
  // Widened on purpose. RedashVisualization.options is untyped JSON on the
  // wire, so an empty string reaches here even though the interface says the
  // field is one of nine literals; narrowed, tsc calls the `=== ''` guard dead
  // code and the runtime then reports a missing type as an unknown one.
  const stored: string | undefined = options.globalSeriesType
  if (stored == null || stored === '') return []
  // No case for `bubble`, deliberately, and adding one back would be a mistake
  // twice over. It had one, warning whenever a column sat in Redash's `size`
  // slot, until ScatterChart learned to draw that column as a ZAxis. The shape
  // is faithful now, so it takes the same path as every other shape the table
  // knows. And the question that is left, whether the mapped size column still
  // exists, cannot be answered from `options` alone: it belongs to
  // missingMappedColumns, which the CHART plugin already runs alongside this
  // and which gets the query result. A check here would be a guess or a second
  // note saying the same thing.
  const deferred = DEFERRED_SHAPES[stored]
  if (deferred != null) return [deferred]
  if (SHAPE_BY_STORED_TYPE[stored] == null) {
    return [`"${stored}" is not a chart type this app can draw, so it is drawn as a line.`]
  }
  return []
}
