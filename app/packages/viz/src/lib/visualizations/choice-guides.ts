
export const CORE_CHOICE_GUIDES: Record<string, string> = {
  counter: 'One row, one number. Any aggregate with no GROUP BY.',
  'chart-line': 'A time column plus one or more measures. The default for anything over time.',
  'chart-area': 'As line, when the measures stack into a total worth seeing.',
  'chart-bar':
    'One grouping column plus one measure, at most about 25 groups. This is the shape for a ranking, ' +
    'a top-N, or a per-category comparison.',
  'chart-pie':
    'One grouping column plus one measure that are parts of a whole, at most about 8 groups.',
  'chart-scatter': 'Two measures, one point per row, to show how they relate.',
  heatmap:
    'TWO grouping columns plus one measure, e.g. one row per station per hour. Order the SELECT so ' +
    'the two grouping columns come first and the measure last.',
  pivot: 'The same shape as heatmap, when the reader needs to read the numbers rather than see a pattern.',
  map: 'Latitude and longitude columns. Alias them exactly `lat` and `lon` in the SELECT.',
  funnel: 'Ordered stages, one count each, each stage a subset of the one before.',
  boxplot: 'A distribution: many observations per category.',
  sankey: 'Flow between two node columns, with a weight.',
  details: 'A single row read as a list of fields.',
  table:
    'The LAST resort, for a result no other shape fits: many columns of mixed types, or rows a reader ' +
    'must scan one by one.',
}
