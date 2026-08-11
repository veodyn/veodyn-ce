import type { MockDashboardWidget } from '@/lib/mock-data'

// ─── Position calculation ───────────────────────────────────────────────────

export function calculateNewWidgetPosition(
  existingWidgets: MockDashboardWidget[],
  sizeX: number,
  sizeY: number,
  cols = 6
): { col: number; row: number } {
  if (existingWidgets.length === 0) return { col: 0, row: 0 }

  // Build occupancy grid
  const maxRow = existingWidgets.reduce(
    (max, w) => Math.max(max, w.options.position.row + w.options.position.sizeY),
    0
  )

  const occupied = new Set<string>()
  for (const w of existingWidgets) {
    const p = w.options.position
    for (let r = p.row; r < p.row + p.sizeY; r++) {
      for (let c = p.col; c < p.col + p.sizeX; c++) {
        occupied.add(`${r},${c}`)
      }
    }
  }

  // Scan row by row for first position that fits
  for (let row = 0; row <= maxRow + 1; row++) {
    for (let col = 0; col <= cols - sizeX; col++) {
      let fits = true
      for (let r = row; r < row + sizeY && fits; r++) {
        for (let c = col; c < col + sizeX && fits; c++) {
          if (occupied.has(`${r},${c}`)) fits = false
        }
      }
      if (fits) return { col, row }
    }
  }

  // Fallback: place below everything
  return { col: 0, row: maxRow }
}

// ─── Default widget size per viz type ───────────────────────────────────────

export function getDefaultSize(vizType: string): { sizeX: number; sizeY: number } {
  switch (vizType) {
    case 'COUNTER': return { sizeX: 2, sizeY: 5 }
    case 'MAP': return { sizeX: 3, sizeY: 10 }
    case 'TABLE': return { sizeX: 3, sizeY: 8 }
    case 'DETAILS': return { sizeX: 3, sizeY: 6 }
    default: return { sizeX: 3, sizeY: 6 }
  }
}
