import { choice, columnOne, count, flag, text } from './fields'
import type { AuthoringSchema } from './types'

const AGGREGATIONS = ['sum', 'avg', 'count', 'min', 'max']

export const COUNTER_AUTHORING: AuthoringSchema = {
  counterLabel: text('Label shown under the number.'),
  countRow: flag('Count the result rows instead of reading a column.'),
  counterColName: columnOne('Column holding the number. Defaults to the first column. Not used when countRow is true.'),
  rowNumber: count('Which row to read, starting at 1.', { default: 1 }),
  targetColName: columnOne('Column holding a target to compare against, from the same row.'),
  stringPrefix: text('Text before the number, such as $.'),
  stringSuffix: text('Text after the number, such as %.'),
  stringDecimal: count('Decimal places, 0 to 10. Automatic when unset.'),
}

export const PIVOT_AUTHORING: AuthoringSchema = {
  rowField: columnOne('Column that becomes the rows.'),
  colField: columnOne('Column that becomes the columns.'),
  valueField: columnOne('Column aggregated into each cell.'),
  aggregation: choice('How values in one cell combine.', AGGREGATIONS, { default: 'sum' }),
}

export const FUNNEL_AUTHORING: AuthoringSchema = {
  stepColumn: columnOne('Column naming each step.'),
  valueColumn: columnOne('Column holding the number at each step.'),
  sortOrder: choice('Order of the steps by value.', ['desc', 'asc'], { default: 'desc' }),
}

export const MAP_AUTHORING: AuthoringSchema = {
  latColName: columnOne('Column holding latitude.'),
  lonColName: columnOne('Column holding longitude.'),
  classify: columnOne('Column whose values choose the marker color.'),
  popup: {
    rule: { object: { enabled: 'boolean', template: 'string' } },
    description: 'Shown when a marker is clicked. template references columns as {{ column_name }}; blank shows all.',
  },
}

export const CHOROPLETH_AUTHORING: AuthoringSchema = {
  boundarySource: choice('map shades a bundled map, column draws one region per row from geometryColumn.', ['map', 'column'], {
    default: 'map',
  }),
  keyColumn: columnOne('Column naming each region, matched against targetField when boundarySource is map.'),
  targetField: choice(
    'Property of the bundled map that keyColumn is matched against. Not a result column. Only with boundarySource map.',
    ['name', 'iso_a2', 'iso_a3']
  ),
  valueColumn: columnOne('Numeric column that shades each region.'),
  mapType: choice('Bundled map to draw. Only with boundarySource map.', ['world-countries'], { default: 'world-countries' }),
  geometryColumn: columnOne('Column holding each region as GeoJSON. Only with boundarySource column.', {
    appliesTo: { key: 'boundarySource', equals: 'column' },
  }),
}

export const COHORT_AUTHORING: AuthoringSchema = {
  dateColumn: columnOne('Column naming the cohort, usually a signup date.'),
  stageColumn: columnOne('Column with periods elapsed since the cohort started (0, 1, 2).'),
  totalColumn: columnOne('Column with the cohort size, the denominator of every cell.'),
  valueColumn: columnOne('Column with how many of the cohort remain at that stage.'),
}

export const SUNBURST_AUTHORING: AuthoringSchema = {
  valueColumn: columnOne('Column sizing each slice. Automatic uses a column named value, or the last column.'),
}

export const KPI_HISTORY_AUTHORING: AuthoringSchema = {
  timeColumn: columnOne('Column with the time of each point. Defaults to the first column.'),
  valueColumn: columnOne('Column with the value of each point. Defaults to the second column.'),
  unit: text('Unit shown after values, such as %.'),
  target: {
    rule: { object: { value: 'number', direction: 'string' } },
    description: 'value is the target; direction is higher-is-better or lower-is-better. Set with thresholds.',
  },
  thresholds: {
    rule: { object: { atRisk: 'number', breached: 'number' } },
    description: 'atRisk and breached are the numbers where status changes. Set together with target.',
  },
}

export const WORD_CLOUD_AUTHORING: AuthoringSchema = {
  column: columnOne('Column holding the text. Required: nothing renders without it.'),
  frequenciesColumn: columnOne('Column holding a count per row. Each row then is one word; without it words are counted in the text.'),
  wordLengthLimit: {
    rule: { object: { min: 'number', max: 'number' } },
    description: 'Hide words shorter than min or longer than max characters.',
  },
  wordCountLimit: {
    rule: { object: { min: 'number', max: 'number' } },
    description: 'Hide words that appear fewer than min or more than max times.',
  },
}
