// Per-type option metadata for the core visualizations: which options name a
// column, and which may be seen by an anonymous reader.
//
// Split out of core.ts, which holds the wiring (renderers, editors, icons,
// builder tiles). These are two different kinds of fact about a type and the
// combined file was over the size limit.
import type { OptionSchema } from './option-schema'

// Column-name option keys per type, paired with the word the editor uses for
// the slot so a problem reads as the analyst thinks of it ("the latitude
// column") rather than as the code spells it ("latColName").
export const NAMED_COLUMNS = {
  MAP: [
    { key: 'latColName', label: 'latitude' },
    { key: 'lonColName', label: 'longitude' },
    { key: 'classify', label: 'group by' },
  ],
  COUNTER: [
    { key: 'counterColName', label: 'value' },
    { key: 'targetColName', label: 'target' },
  ],
  PIVOT: [
    { key: 'rowField', label: 'row' },
    { key: 'colField', label: 'column' },
    { key: 'valueField', label: 'value' },
  ],
  FUNNEL: [
    { key: 'stepColumn', label: 'step' },
    { key: 'valueColumn', label: 'value' },
  ],
  CHOROPLETH: [
    { key: 'keyColumn', label: 'key' },
    { key: 'valueColumn', label: 'value' },
  ],
  COHORT: [
    { key: 'dateColumn', label: 'cohort' },
    { key: 'stageColumn', label: 'stage' },
    { key: 'totalColumn', label: 'cohort total' },
    { key: 'valueColumn', label: 'value' },
  ],
  SUNBURST: [{ key: 'valueColumn', label: 'value' }],
  // 'time' rather than 'timestamp': the editor's slot is "Time Column", and a
  // problem has to read as the analyst thinks of it.
  KPI_HISTORY: [
    { key: 'timeColumn', label: 'time' },
    { key: 'valueColumn', label: 'value' },
  ],
  WORD_CLOUD: [
    { key: 'column', label: 'words' },
    { key: 'frequenciesColumn', label: 'frequencies' },
  ],
} as const

const SERIES_OPTION: OptionSchema = {
  name: 'string',
  type: 'string',
  color: 'string',
  yAxis: 'number',
  curve: 'string',
}

const AXIS_OPTION: OptionSchema = {
  type: 'string',
  opposite: 'boolean',
  rangeMin: 'number',
  rangeMax: 'number',
}

const REFERENCE_LINE: OptionSchema = {
  value: 'number',
  label: 'string',
  color: 'string',
  axis: 'string',
}

const TABLE_COLUMN: OptionSchema = {
  name: 'string',
  visible: 'boolean',
  order: 'number',
  title: 'string',
  type: 'string',
  displayAs: 'string',
}

// min/max bounds, shared by the word cloud's two limits.
const WORD_LIMIT: OptionSchema = {
  min: 'number',
  max: 'number',
}

/**
 * What each core type lets an anonymous reader see, naming only what its
 * renderer actually reads (components/visualizations/*).
 *
 * A type whose plugin omits `publicOptions` gets `{}` on a public report,
 * which strips the column mapping it needs and leaves it drawing its own empty
 * state. public-report-options.test.ts asserts every registered type declares
 * one, so a new visualization cannot reach a public report half-configured.
 */
export const CORE_PUBLIC_OPTIONS = {
  CHART: {
    globalSeriesType: 'string',
    columnMapping: { stringMap: true },
    seriesOptions: { objectMap: SERIES_OPTION },
    yAxis: { array: { object: AXIS_OPTION } },
    xAxis: { object: { type: 'string' } },
    series: { object: { stacking: 'string' } },
    stacking: 'string',
    swappedAxes: 'boolean',
    reverseX: 'boolean',
    showDataLabels: 'boolean',
    donut: 'boolean',
    lineStyle: 'string',
    referenceLines: { array: { object: REFERENCE_LINE } },
    legend: { object: { enabled: 'boolean' } },
    showLegend: 'boolean',
    indexed: 'boolean',
  },
  COUNTER: {
    counterColName: 'string',
    counterLabel: 'string',
    countRow: 'boolean',
    rowNumber: 'number',
    targetRowNumber: 'number',
    targetColName: 'string',
    stringPrefix: 'string',
    stringSuffix: 'string',
    stringDecimal: 'number',
  },
  TABLE: { columns: { array: { object: TABLE_COLUMN } } },
  MAP: {
    latColName: 'string',
    lonColName: 'string',
    classify: 'string',
    tooltip: { object: { enabled: 'boolean', template: 'string' } },
    popup: { object: { enabled: 'boolean', template: 'string' } },
  },
  CHOROPLETH: {
    mapType: 'string',
    keyColumn: 'string',
    targetField: 'string',
    valueColumn: 'string',
  },
  PIVOT: {
    rowField: 'string',
    colField: 'string',
    valueField: 'string',
    aggregation: 'string',
  },
  FUNNEL: {
    stepColumn: 'string',
    valueColumn: 'string',
    sortOrder: 'string',
  },
  // Column names, not the table's column descriptors: the details renderer
  // reads `options.columns` as a list of names to show.
  DETAILS: { columns: { array: 'string' } },
  HEATMAP: {
    columnMapping: { stringMap: true },
    aggregation: 'string',
    showValues: 'string',
    clipOutliers: 'boolean',
    sortRows: 'string',
  },
  BOXPLOT: { columnMapping: { stringMap: true } },
  SANKEY: { columnMapping: { stringMap: true } },
  COHORT: {
    dateColumn: 'string',
    stageColumn: 'string',
    totalColumn: 'string',
    valueColumn: 'string',
    timeInterval: 'string',
    mode: 'string',
  },
  SUNBURST_SEQUENCE: { valueColumn: 'string' },
  // Everything the renderer reads and nothing else. The target and the
  // thresholds are declared rather than withheld because this type IS the
  // comparison: strip them and a public reader gets a bare line on a
  // self-relative scale, which is the "renders unconfigured" failure the field
  // exists to prevent, and it would silently contradict the authenticated view
  // of the same widget. Nothing identifying is declared, and nothing is
  // declared that the chart does not draw: a bag that picked up a kpiId, an
  // owner or a source query on its way through a promote-a-dashboard copy loses
  // them here.
  KPI_HISTORY: {
    timeColumn: 'string',
    valueColumn: 'string',
    unit: 'string',
    target: { object: { value: 'number', direction: 'string' } },
    thresholds: { object: { atRisk: 'number', breached: 'number' } },
  },
  WORD_CLOUD: {
    column: 'string',
    frequenciesColumn: 'string',
    wordLengthLimit: { object: WORD_LIMIT },
    wordCountLimit: { object: WORD_LIMIT },
  },
} satisfies Record<string, OptionSchema>
