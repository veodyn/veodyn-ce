// Drawing fewer rows than the query returned, when there are far more of them
// than the plot has pixels.
//
// The chart this was written for plots six series of minute-resolution capture
// over a day: about 1,400 rows per series into roughly 700 pixels, so every
// line is two samples deep in every column of the plot and none of them can be
// followed. Most of that ink is not information, it is overdraw.
//
// Two rules the reduction holds to, and they are the reason this is a
// selection rather than an aggregation:
//
// 1. Every drawn point is a row the query really returned. Nothing here
//    averages, interpolates or smooths, so a value read off this chart, out of
//    its tooltip, or out of the text summary is a number that came from the
//    warehouse. A bucketed mean would be a figure with no source, which is the
//    thing this codebase refuses to put in front of a reader.
// 2. Every series keeps its own highest and lowest row. A reduction that drops
//    a spike does not simplify the chart, it removes the event, and the reader
//    has no way to know it happened. Those rows are pinned before anything
//    else is chosen.

// Roughly one point per pixel on a wide plot. Past this the extra rows land on
// pixels that are already painted.
export const MAX_PLOTTED_ROWS = 800

function isNumeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The indices of the rows holding each series' minimum and maximum.
 *
 * Per series rather than overall: the maximum of the busiest line says nothing
 * about where the quietest one peaked, and a chart that keeps only the former
 * flattens every series but one.
 */
function extremeIndices(rows: Record<string, unknown>[], seriesNames: string[]): Set<number> {
  const keep = new Set<number>()

  for (const name of seriesNames) {
    let lowest = Infinity
    let highest = -Infinity
    let lowestAt = -1
    let highestAt = -1

    for (let index = 0; index < rows.length; index += 1) {
      const value = rows[index][name]
      if (!isNumeric(value)) continue
      if (value < lowest) {
        lowest = value
        lowestAt = index
      }
      if (value > highest) {
        highest = value
        highestAt = index
      }
    }

    if (lowestAt >= 0) keep.add(lowestAt)
    if (highestAt >= 0) keep.add(highestAt)
  }

  return keep
}

/**
 * `rows` reduced to at most `maxRows`, in their original order.
 *
 * Returns the input array itself when it is already short enough, so the
 * common case allocates nothing and a caller can compare by reference.
 */
export function downsampleRows(
  rows: Record<string, unknown>[],
  seriesNames: string[],
  maxRows: number = MAX_PLOTTED_ROWS
): Record<string, unknown>[] {
  if (maxRows < 2 || rows.length <= maxRows) return rows

  const keep = extremeIndices(rows, seriesNames)
  // The ends are the axis' own extent. Dropping either shortens the line
  // without shortening the axis, which reads as missing data at the edge.
  keep.add(0)
  keep.add(rows.length - 1)

  // Evenly spaced fill for whatever budget the pinned rows left. Even spacing
  // rather than shape-fitting: the spikes are already pinned above, so what is
  // left to do is cover the span without clumping.
  const remaining = maxRows - keep.size
  if (remaining > 0) {
    const step = (rows.length - 1) / (remaining + 1)
    for (let n = 1; n <= remaining; n += 1) {
      keep.add(Math.round(n * step))
    }
  }

  // Pinned rows alone can exceed the budget when a document has many series.
  // They are the ones worth keeping, so the budget yields rather than the
  // spikes: this is a readability measure, not a hard cap.
  return [...keep].sort((a, b) => a - b).map((index) => rows[index])
}
