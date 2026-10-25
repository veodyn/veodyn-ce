import { choice, flag, roleMapping } from './fields'
import type { AuthoringSchema } from './types'

export const CHART_AUTHORING: AuthoringSchema = {
  globalSeriesType: choice('Chart shape.', ['line', 'bar', 'area', 'pie', 'scatter']),
  columnMapping: roleMapping(
    'Result column name to its role: x, y, series (one line or bar per value), yRight (extra series).',
    ['x', 'y', 'series', 'yRight']
  ),
  series: {
    rule: { object: { stacking: 'string' } },
    description: 'Bar and area only. stacking is disabled, stack or percent.',
  },
  swappedAxes: flag('Bar only. Draw horizontal bars.'),
  donut: flag('Pie only. Draw a donut.'),
  seriesOptions: {
    rule: { objectMap: { name: 'string', color: 'string', type: 'string', curve: 'string' } },
    description:
      'Per series, keyed by series name: name (label), color, type (line, column or area; line and area charts only), curve (linear, step or natural; line and area charts only).',
  },
  xAxis: {
    rule: { object: { type: 'string' } },
    description: 'Not for pie. type is datetime to force dates, or - to detect.',
  },
  reverseX: flag('Line, bar and area. Reverse the x axis.'),
  yAxis: {
    rule: { array: { object: { type: 'string', rangeMin: 'number', rangeMax: 'number' } } },
    description:
      'Not for pie. Only the first entry is used: type (linear or logarithmic), rangeMin, rangeMax. Ignored when indexed.',
  },
  indexed: flag('Not for scatter or pie. Index every series to 100. Not available while stacking.'),
  referenceLines: {
    rule: { array: { object: { value: 'number', label: 'string' } } },
    description: 'Not for pie. Horizontal lines at a y value, each with a label. Ignored when indexed.',
  },
  showDataLabels: flag('Print each value on its mark.'),
}
