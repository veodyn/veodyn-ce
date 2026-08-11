// KPI_HISTORY: a run of readings drawn against the target and thresholds they
// are judged by.
//
// It lives in its own module rather than as a fifteenth literal in core.ts
// because that file is at the size limit the pre-tool hook enforces. This is
// new code with no existing importers, which makes it the cheapest seam
// available: moving an established entry out instead would churn code nobody
// is changing, and split the fourteen types across two files on no principle
// anyone could state afterwards. core.ts imports this one name.
import { Target } from 'lucide-react'
import { thresholdOrderError } from '@/lib/metric-thresholds'
import {
  kpiHistoryReadings,
  kpiHistoryTarget,
  kpiHistoryThresholds,
} from '@/components/visualizations/kpi-history-model'
import { timeOrderOf } from '@/components/visualizations/kpi-history-summary'
import { KpiHistoryThumbnail } from '@/components/visualizations/viz-thumbnails'
import type { RedashKpiHistoryOptions } from '@/services/redash/types'
// Loaded on demand, like every other registered component: `validate` below
// runs on every route that registers, the drawing does not. The three recovery
// functions above come from ./kpi-history-model rather than from the renderer
// for exactly that reason. See ./lazy-components.ts.
import { KpiHistoryEditor, KpiHistoryRenderer } from './lazy-components'
import { CORE_PUBLIC_OPTIONS, NAMED_COLUMNS } from './core-options'
import { PLUGIN_API_VERSION, type VisualizationPlugin } from './plugin'
import { missingNamedColumns } from './validate-columns'

// The target and the thresholds are read together: historyScale builds one y
// domain out of all three numbers. Each half on its own fails silently, in its
// own direction. Thresholds with no target shade nothing, because there is no
// scale to place a band on. A target with no thresholds keeps the self-relative
// dataMin/dataMax domain, and recharts discards a ReferenceLine that falls
// outside the domain, so a target far from the readings, which is exactly when
// a reader most needs to see it, is the case that vanishes.
const NO_TARGET =
  'Thresholds are set but no target is, so there is no scale to place a status band on. Set a target as well.'
const NO_THRESHOLDS =
  'A target is set but no thresholds are, so the axis is scaled to the readings alone and the target line can fall outside it. Set At Risk and Breached as well.'
// Clearing the Target input leaves the direction behind, so the options still
// carry a `target` object with nothing to draw.
const TARGET_WITHOUT_VALUE =
  'The target has a direction but no value, so neither the target line nor the status bands are drawn. Enter a target value.'
const INCOMPLETE_THRESHOLDS =
  'A status band needs both At Risk and Breached as numbers. Set both, or clear both.'
const UNORDERED_ROWS =
  'The rows are not in ascending time order, so the line is drawn in the order the query returned them rather than left to right in time. Order the query by the time column, ascending.'

/**
 * Has anything at all been written into one of the two nested groups?
 *
 * Not `!= null`. The editor prunes a group whose every field has been cleared,
 * but an options bag from anywhere else can still carry `{}` or
 * `{ value: undefined }`, and both of those mean "unconfigured" rather than
 * "half configured". Takes `unknown` because validate is handed a raw bag and
 * `Object.values(null)` throws, which the plugin interface forbids.
 */
function started(group: unknown): boolean {
  if (group == null || typeof group !== 'object') return false
  return Object.values(group).some((value) => value !== undefined)
}

/**
 * What the chart needs before it can draw the comparison it exists for.
 *
 * Checks the numbers the RENDERER resolves rather than the presence of the two
 * nested objects, which is the difference between "a target is set" and "there
 * is a target to draw". `{ direction: 'higher-is-better', value: undefined }`
 * is what the editor leaves behind when the Target input is cleared: it answers
 * yes to the first question and no to the second, and the chart silently loses
 * its target line, its scale and its bands while nothing is reported.
 */
function comparisonProblems(options: RedashKpiHistoryOptions): string[] {
  const target = kpiHistoryTarget(options)
  const thresholds = kpiHistoryThresholds(options)
  if (target && thresholds) {
    // The KPI form's own invariant rather than a second opinion about it: with
    // higher-is-better, atRisk 70 and breached 90, statusForValue calls a
    // reading of 80 breached, and statusBands shades overlapping bands that
    // contradict each other.
    const order = thresholdOrderError(target.direction, thresholds.atRisk, thresholds.breached)
    return order ? [order] : []
  }
  // A widget created from a builder tile has neither, and "you have not
  // finished configuring this" is not a problem to report on a fresh one.
  if (!started(options.target) && !started(options.thresholds)) return []
  const problems: string[] = []
  if (!target) problems.push(started(options.target) ? TARGET_WITHOUT_VALUE : NO_TARGET)
  if (!thresholds) {
    problems.push(started(options.thresholds) ? INCOMPLETE_THRESHOLDS : NO_THRESHOLDS)
  }
  return problems
}

export const KPI_HISTORY_VISUALIZATION: VisualizationPlugin = {
  apiVersion: PLUGIN_API_VERSION,
  type: 'KPI_HISTORY',
  displayName: 'KPI History',
  // The target is what separates this from a line chart, so the icon says
  // "measured against something" rather than "goes up".
  icon: Target,
  // Deliberately empty, for the reason the four parity types below CHOROPLETH
  // in core.ts are: the renderer falls back positionally with `||`, which
  // treats a seeded '' as a real answer and would defeat its own fallback.
  defaultOptions: {},
  publicOptions: CORE_PUBLIC_OPTIONS.KPI_HISTORY,
  Renderer: KpiHistoryRenderer,
  Editor: KpiHistoryEditor,
  validate: (rawOptions, data) => {
    const options = rawOptions as RedashKpiHistoryOptions
    const problems = missingNamedColumns(rawOptions, NAMED_COLUMNS.KPI_HISTORY, data)
    problems.push(...comparisonProblems(options))
    // Asked of the readings rather than of the raw rows, because the readings
    // are what gets drawn: a dropped row cannot put the line out of order.
    // Only a PROVEN inversion is reported; see timeOrderOf for what 'unknown'
    // is and why it stays quiet here.
    if (timeOrderOf(kpiHistoryReadings(options, data)) === 'unordered') {
      problems.push(UNORDERED_ROWS)
    }
    return problems
  },
  choices: [
    { id: 'kpi-history', label: 'KPI History', options: {}, Thumbnail: KpiHistoryThumbnail },
  ],
}
