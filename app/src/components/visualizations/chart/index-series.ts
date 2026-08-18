// Indexes every named series against its own first meaningful value, so series
// of wildly different magnitude land on one axis instead of two independent
// y-scales whose alignment is arbitrary.
//
// Division is by the base's magnitude, not the signed base, with each value's
// sign kept: a signed negative base flips later values, turning a rising
// [-50, -25, 50] into [100, 50, -100] rather than [-100, -50, 100]. So a series
// that starts negative begins at -100. A positive base is unaffected, since
// there the magnitude equals the base.
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

// The base is the first finite, non-zero value in plotted order, as an absolute
// magnitude. Non-zero, because a series starting at zero is ordinary and
// dividing by it would not work. No finite non-zero value anywhere means no base.
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
