// Drawing fewer rows than the query returned, when there are far more of them
// than the plot has pixels (the chart this was written for plots about 1,400
// rows per series into roughly 700 pixels).
//
// A selection, never an aggregation: every drawn point is a row the query
// really returned, and every series keeps its own highest and lowest row, so a
// reduction cannot drop a spike.

// Roughly one point per pixel on a wide plot.
export const MAX_PLOTTED_ROWS = 800

function isNumeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The indices of the rows holding each series' minimum and maximum.
 *
 * Per series rather than overall: the maximum of the busiest line says nothing
 * about where the quietest one peaked.
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

  // Evenly spaced fill for whatever budget the pinned rows left: the spikes are
  // already pinned, so what is left is covering the span without clumping.
  const remaining = maxRows - keep.size
  if (remaining > 0) {
    const step = (rows.length - 1) / (remaining + 1)
    for (let n = 1; n <= remaining; n += 1) {
      keep.add(Math.round(n * step))
    }
  }

  // Pinned rows alone can exceed the budget when a document has many series, so
  // `maxRows` is a readability measure rather than a hard cap.
  return [...keep].sort((a, b) => a - b).map((index) => rows[index])
}
