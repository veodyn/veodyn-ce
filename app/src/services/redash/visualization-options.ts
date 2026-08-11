// RedashVisualization.options is Record<string, unknown> at the wire-type
// level (matches Redash's own untyped JSON blob); these are additive,
// narrower interfaces renderers/editors cast into locally
// (`options as RedashChartOptions`), not a replacement for the field.

export interface RedashSeriesOptions {
  name?: string
  type?: 'line' | 'area' | 'column' | 'bar' | 'pie' | 'scatter'
  color?: string
  yAxis?: 0 | 1
  curve?: 'linear' | 'monotone' | 'step' | 'natural'
}

export interface RedashAxisOptions {
  type?: 'linear' | 'logarithmic'
  opposite?: boolean
  rangeMin?: number
  rangeMax?: number
}

export interface RedashReferenceLine {
  value: number
  label?: string
  color?: string
  axis?: 'x' | 'y'
}

/**
 * Every value `globalSeriesType` can carry: the eight Redash's own chart
 * editor can write, plus this app's own `bar` spelling (Redash never writes
 * `bar` itself; it writes `column` for a vertical bar chart, and this app's
 * AI-authored and default-visualization paths write `bar` directly). This
 * array is the single source of truth the type below is derived from, so a
 * value can no longer be added to one without the other silently drifting:
 * chart-shape-contract.test.ts imports this same array rather than keeping
 * its own hand-copied list, which is what let a ninth type (`bar`) go
 * unnoticed by that test's completeness assertion.
 */
export const REDASH_GLOBAL_SERIES_TYPES = [
  'line',
  'bar',
  'area',
  'pie',
  'scatter',
  'column',
  'bubble',
  'box',
  'heatmap',
] as const

export interface RedashChartOptions {
  /**
   * Narrowing this to what can be drawn is what hid the original bug: the
   * compiler agreed the renderer's five cases were exhaustive while the wire
   * carried eight. resolveChartShape (chart/chart-shape.ts) maps this to a
   * drawable shape and chartShapeProblems reports whatever it cannot draw.
   */
  globalSeriesType?: (typeof REDASH_GLOBAL_SERIES_TYPES)[number]
  // 'size' is Redash's bubble-size role ("Bubble Size Column" in its
  // ColumnMappingSelect), and a column in that slot is the whole difference
  // between a bubble chart and the scatter it shares a shape with.
  // resolveChartConfig (chart/resolve-config.ts) surfaces it as `sizeCol` and
  // ScatterChart binds it to a recharts ZAxis, so a mark's area carries it.
  columnMapping?: Record<string, 'x' | 'y' | 'yRight' | 'series' | 'size'>
  seriesOptions?: Record<string, RedashSeriesOptions>
  yAxis?: RedashAxisOptions[] // [left, right]
  xAxis?: { type?: 'datetime' | 'category' | 'linear' }
  series?: { stacking?: 'stack' | 'percent' | 'disabled' }
  // Legacy flat key some existing widgets/mocks use; superseded by
  // series.stacking but still read as a fallback.
  stacking?: 'stack' | 'disabled'
  swappedAxes?: boolean
  reverseX?: boolean
  showDataLabels?: boolean
  donut?: boolean
  lineStyle?: 'linear' | 'monotone' | 'step' | 'natural'
  referenceLines?: RedashReferenceLine[]
  legend?: { enabled?: boolean }
  showLegend?: boolean
  // Explicit override for indexed comparison rendering (every series shown
  // as a percentage of its own first nonzero value, on one shared axis). When
  // absent, resolveChartConfig infers it from a saved chart's old dual-axis
  // signals (a per-series right axis, or a column mapped to yRight).
  indexed?: boolean
}

export interface RedashCounterOptions {
  counterColName?: string
  counterLabel?: string
  rowNumber?: number
  targetRowNumber?: number
  targetColName?: string
  stringPrefix?: string
  stringSuffix?: string
  stringDecimal?: number
  // Redash-native option: display the number of result rows instead of a cell value.
  countRow?: boolean
}

export interface RedashTableColumnOptions {
  name: string
  visible?: boolean
  order?: number
  title?: string
  type?: string
  /**
   * How the cell is drawn. This was declared as the literal `'string'`, which
   * is not a value any Redash column carries, so every real one was a type
   * error waiting to happen. These are the kinds veodyn renders; Redash also
   * has `json`.
   */
  displayAs?: 'text' | 'number' | 'datetime' | 'boolean' | 'link' | 'image'
  // Templates for the link and image kinds. `{{ other_column }}` reads another
  // column of the same row; `{{ @ }}` reads this one.
  linkUrlTemplate?: string
  linkTextTemplate?: string
  linkTitleTemplate?: string
  linkOpenInNewTab?: boolean
  imageUrlTemplate?: string
  imageTitleTemplate?: string
  imageWidth?: string
  imageHeight?: string
}

export interface RedashTableOptions {
  columns?: RedashTableColumnOptions[]
}

export interface RedashHeatmapOptions {
  columnMapping?: Record<string, 'x' | 'y' | 'value'>
  // How duplicate (x, y) cells combine. 'count' needs no value column.
  aggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max'
  // Whether cells show their numeric value. 'auto' (the default) shows values
  // on a small grid and hides them past HEATMAP_VALUE_DENSITY_THRESHOLD, since
  // a dense grid full of numbers reads as noise rather than data. 'always' and
  // 'never' override that heuristic outright.
  showValues?: 'auto' | 'always' | 'never'
  // When true, the colour domain is clipped to the 2nd/98th percentile of the
  // cell values (see heatmap-model.ts) instead of the true min/max, so one
  // extreme cell stops compressing every other row into the bottom of the
  // ramp. Cells outside the clipped domain still render, clamped to the
  // endpoint colour: they are never hidden or misrepresented as in-range.
  clipOutliers?: boolean
  // Row (y-axis) order. 'none' is the default because it is the order every
  // heatmap saved before this option existed already renders in: the order the
  // rows first appear in the query result. Defaulting to anything else would
  // silently reshape stored visualizations nobody re-authored. 'total' ranks
  // rows by the sum of their cells, 'peak' by their single largest cell, both
  // descending so the rows worth reading sit at the top. The two deliberately
  // disagree: a row that is moderately busy in every column outranks a row
  // that is quiet except for one spike under 'total', and they swap under
  // 'peak'.
  sortRows?: 'none' | 'total' | 'peak'
}

export interface RedashBoxPlotOptions {
  columnMapping?: Record<string, 'category' | 'value'>
}

export interface RedashSankeyOptions {
  columnMapping?: Record<string, 'source' | 'target' | 'value'>
}

export interface RedashChoroplethOptions {
  mapType?: string
  keyColumn?: string
  targetField?: string
  valueColumn?: string
}

// Cohort mirrors Redash's "simple" retention-grid shape (cohort key x stage,
// one value per cell). The moment-based diagonal gap-filling that stock
// Redash applies for mode: 'diagonal' is out of scope here; timeInterval and
// mode are kept on the type so the option shape matches Redash's wire format,
// but buildCohortModel (src/components/visualizations/cohort-model.ts) only
// implements the simple pivot.
export interface RedashCohortOptions {
  dateColumn?: string
  stageColumn?: string
  totalColumn?: string
  valueColumn?: string
  timeInterval?: 'daily' | 'weekly' | 'monthly'
  mode?: 'simple' | 'diagonal'
}

export interface RedashSunburstOptions {
  valueColumn?: string
}

export interface RedashWordCloudOptions {
  column?: string
  frequenciesColumn?: string
  wordLengthLimit?: { min?: number; max?: number }
  wordCountLimit?: { min?: number; max?: number }
}

// Matches Redash's actual Map (Markers) visualization options
// (upstream Redash viz-lib/src/visualizations/map/getOptions.ts): latColName and
// lonColName, not latColumn/lonColumn; no numeric zoom key; tooltip/popup are
// nested {enabled, template} objects with {{ column }} placeholders.
export interface RedashMapOptions {
  latColName?: string
  lonColName?: string
  classify?: string
  tooltip?: { enabled?: boolean; template?: string }
  popup?: { enabled?: boolean; template?: string }
}

// The KPI history line: a run of readings drawn against the target and the
// thresholds the readings are judged by.
//
// Two of these name columns and the rest are constants, which is the shape of
// the type rather than an oversight. A target is a property of the KPI, not
// something a row carries, so reading it out of the result would mean picking
// one row to believe. `target` and `thresholds` mirror KpiTarget and
// KpiThresholds (src/types/kpi.ts) field for field, so a KPI's own definition
// copies into a widget without being reshaped on the way. The direction union
// is spelled out here rather than imported for the reason every other union in
// this file is: these are wire shapes, and the file carries no imports.
export interface RedashKpiHistoryOptions {
  // Both fall back positionally to the first and second columns when unset,
  // the same fallback the funnel uses, so a freshly created widget draws
  // something instead of an empty panel.
  timeColumn?: string
  valueColumn?: string
  // '%', 'ms', 'snapshots/hr'. Mirrors Kpi.unit, and is a label rather than a
  // conversion: nothing here scales a value by it.
  unit?: string
  // Read together. The y domain is built from both at once (kpi-history-model),
  // so a target without thresholds leaves the target line free to fall off a
  // self-relative scale, and thresholds without a target draw no status bands
  // at all. Both failures are silent, so validate reports them.
  target?: { value?: number; direction?: 'higher-is-better' | 'lower-is-better' }
  thresholds?: { atRisk?: number; breached?: number }
}
