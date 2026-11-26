import { describe, expect, it } from 'vitest'
import type { MockDashboardWidget } from '@/lib/mock-data'
import { changedPositions } from './layout-changes'

function widget(id: number, col: number, row: number, sizeX: number, sizeY: number): MockDashboardWidget {
  return { id, dashboard_id: 1, width: 1, options: { position: { col, row, sizeX, sizeY } } }
}

const widgets = [widget(1, 0, 0, 3, 8), widget(2, 3, 0, 3, 8)]

describe('changedPositions', () => {
  it('returns nothing when the layout matches what is saved', () => {
    const layout = [
      { i: '1', x: 0, y: 0, w: 3, h: 8 },
      { i: '2', x: 3, y: 0, w: 3, h: 8 },
    ]
    expect(changedPositions(widgets, layout)).toEqual([])
  })

  it('returns only the widgets whose position or size moved', () => {
    const layout = [
      { i: '1', x: 0, y: 0, w: 3, h: 8 },
      { i: '2', x: 0, y: 8, w: 6, h: 8 },
    ]
    expect(changedPositions(widgets, layout)).toEqual([{ id: 2, col: 0, row: 8, sizeX: 6, sizeY: 8 }])
  })

  it('ignores layout items that are not saved widgets', () => {
    const layout = [{ i: '__dropping-elem__', x: 0, y: 0, w: 1, h: 1 }]
    expect(changedPositions(widgets, layout)).toEqual([])
  })
})
