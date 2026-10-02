// When the chat model should pick each CORE shape, one sentence apiece.
//
// These belong on the choices in ./core.ts, next to the label and the
// thumbnail, and they are here instead for one reason: that file sits three
// lines under the size hook's block threshold, and fourteen guide strings would
// push it well over. A plugin declares its guide inline on the choice, which is
// where this would be too if there were room. See VisualizationChoice.guide.
//
// This is the SOURCE of the shape guide the chat model is given. The same prose
// used to live in api/veodyn_api/services/ai_viz_choice.py as a hardcoded
// VIZ_RULES string, hand-copied alongside a hardcoded list of ids — which is
// why no pack visualization could ever be offered: the API cannot import
// TypeScript, so a plugin's shapes were invisible to it. The catalog the chat
// route now sends upstream carries these, and the API renders the guide from
// whatever it is given. Edit the wording here, not there.

/**
 * Keyed by choice id, not by visualization type: five of these are one CHART
 * told apart by `globalSeriesType`, and they are the entries most worth telling
 * apart, since choosing between a line and a bar is the choice the model gets
 * wrong most often.
 *
 * An id absent from this map is not an error. It arrives in the catalog with no
 * guide, and the model picks it on its label alone.
 */
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
  // The aliasing instruction is not decoration. The MAP renderer reads
  // row[latColName] with no positional fallback, so a result whose coordinates
  // are called something else draws an empty basemap and reports no problem.
  // mapCoordinateOptions now repoints the common spellings, and this keeps the
  // uncommon ones (`pickup_lat`, `origin_y`) out of that situation entirely.
  map: 'Latitude and longitude columns. Alias them exactly `lat` and `lon` in the SELECT.',
  funnel: 'Ordered stages, one count each, each stage a subset of the one before.',
  boxplot: 'A distribution: many observations per category.',
  sankey: 'Flow between two node columns, with a weight.',
  details: 'A single row read as a list of fields.',
  table:
    'The LAST resort, for a result no other shape fits: many columns of mixed types, or rows a reader ' +
    'must scan one by one.',
}
