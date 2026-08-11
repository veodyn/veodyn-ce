// Indexes every named series against its own first meaningful value, so
// series of wildly different magnitude land on one honest axis instead of
// two independent y-scales whose alignment is arbitrary and invents a
// correlation that is not in the data.
//
// Division is by the base's MAGNITUDE, not the signed base, with the sign of
// each value kept intact. A series is indexed relative to where it started;
// dividing by a signed negative base would flip every later value's sign
// relative to the raw data (an ordinary rising profit-and-loss series like
// [-50, -25, 50] would come out as [100, 50, -100]: falling, then inverting,
// while the raw data rises the whole time). Dividing by the magnitude keeps
// direction and ratios faithful: that same series becomes [-100, -50, 100].
// Deliberate consequence: a series that starts negative begins at -100, not
// 100. That is honest, not a wart, since the whole point of the index is
// "where is this relative to where it started," and a series that started
// at a deficit should not be drawn as though it started at the same place as
// one that started at a surplus. A positive-base series is unaffected: for a
// positive base, the magnitude equals the base.
export function indexSeries(
  rows: Record<string, unknown>[],
  xCol: string,
  seriesNames: string[],
): Record<string, unknown>[] {
  // Never index the x column, even if a caller passes it in seriesNames by mistake.
  const names = seriesNames.filter((name) => name !== xCol)

  const baseMagnitudes = new Map<string, number | null>()
  for (const name of names) {
    baseMagnitudes.set(name, firstFiniteNonZeroMagnitude(rows, name))
  }

  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row }
    for (const name of names) {
      next[name] = indexedValue(row[name], baseMagnitudes.get(name) ?? null)
    }
    return next
  })
}

// The base is the first finite, non-zero value in plotted order, taken as an
// absolute magnitude. A series that starts at zero and rises is an ordinary
// case, so the first non-null value is not enough: dividing by zero would
// break it. A series with no finite non-zero value anywhere has no base at
// all.
function firstFiniteNonZeroMagnitude(rows: Record<string, unknown>[], name: string): number | null {
  for (const row of rows) {
    const value = row[name]
    if (value === null || value === undefined) continue
    const num = Number(value)
    if (Number.isFinite(num) && num !== 0) return Math.abs(num)
  }
  return null
}

function indexedValue(value: unknown, baseMagnitude: number | null): number | null {
  if (baseMagnitude === null || value === null || value === undefined) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return (num / baseMagnitude) * 100
}
