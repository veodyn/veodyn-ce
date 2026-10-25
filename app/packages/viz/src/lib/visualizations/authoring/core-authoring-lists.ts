import { choice, flag, roleMapping } from './fields'
import type { AuthoringSchema } from './types'

export const TABLE_AUTHORING: AuthoringSchema = {
  columns: {
    rule: {
      array: {
        object: {
          name: 'string',
          visible: 'boolean',
          order: 'number',
          title: 'string',
          displayAs: 'string',
          linkUrlTemplate: 'string',
          linkTextTemplate: 'string',
          imageUrlTemplate: 'string',
          imageTitleTemplate: 'string',
        },
      },
    },
    description:
      'One entry per result column: name (the column), visible, order, title, displayAs (text, number, datetime, boolean, link or image), and link or image templates that reference columns as {{ column_name }} and this one as {{ @ }}.',
    column: 'listOfObjectsByName',
  },
}

export const DETAILS_AUTHORING: AuthoringSchema = {
  columns: {
    rule: { array: 'string' },
    description: 'Names of the columns to show. Empty shows all.',
    column: 'list',
  },
}

export const HEATMAP_AUTHORING: AuthoringSchema = {
  columnMapping: roleMapping('Result column name to its role: x (columns), y (rows), value.', ['x', 'y', 'value']),
  aggregation: choice('How rows landing in one cell combine. count needs no value column.', ['sum', 'count', 'avg', 'min', 'max'], {
    default: 'sum',
  }),
  showValues: choice('Print values in cells. auto hides them on dense grids.', ['auto', 'always', 'never'], { default: 'auto' }),
  clipOutliers: flag('Clip the color scale to the 2nd and 98th percentile.'),
  sortRows: choice('Row order: source order, by row total, or by peak cell.', ['none', 'total', 'peak'], { default: 'none' }),
}

export const BOXPLOT_AUTHORING: AuthoringSchema = {
  columnMapping: roleMapping('Result column name to its role: category, value.', ['category', 'value']),
}

export const SANKEY_AUTHORING: AuthoringSchema = {
  columnMapping: roleMapping('Result column name to its role: source, target, value.', ['source', 'target', 'value']),
}
