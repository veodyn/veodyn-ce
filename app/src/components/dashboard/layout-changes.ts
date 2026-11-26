import type { Layout } from 'react-grid-layout'
import type { MockDashboardWidget } from '@/lib/mock-data'

export interface WidgetPosition {
  id: number
  col: number
  row: number
  sizeX: number
  sizeY: number
}

export function changedPositions(widgets: readonly MockDashboardWidget[], layout: Layout): WidgetPosition[] {
  const saved = new Map(widgets.map((w) => [String(w.id), w.options.position]))
  return layout.flatMap((item) => {
    const before = saved.get(item.i)
    if (!before) return []
    const unchanged =
      before.col === item.x && before.row === item.y && before.sizeX === item.w && before.sizeY === item.h
    if (unchanged) return []
    return [{ id: Number(item.i), col: item.x, row: item.y, sizeX: item.w, sizeY: item.h }]
  })
}
