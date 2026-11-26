import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Layout } from 'react-grid-layout'
import type { MockDashboardWidget } from '@/lib/mock-data'

type GridProps = Record<string, unknown> & {
  onDragStop?: (layout: Layout) => void
  onResizeStop?: (layout: Layout) => void
}

const grid = vi.hoisted(() => ({ width: 1200, props: null as GridProps | null }))

vi.mock('react-grid-layout', () => ({
  useContainerWidth: () => ({ width: grid.width, containerRef: { current: null } }),
  ResponsiveGridLayout: (props: GridProps) => {
    grid.props = props
    return null
  },
}))
vi.mock('react-grid-layout/css/styles.css', () => ({}))
vi.mock('./visualization-widget', () => ({ VisualizationWidget: () => null }))
vi.mock('./textbox-widget', () => ({ TextboxWidget: () => null }))

import { DashboardGrid, WIDE_LAYOUT_MIN_WIDTH } from './dashboard-grid'

const widgets: MockDashboardWidget[] = [
  { id: 113, dashboard_id: 22, width: 1, text: 'captures', options: { position: { col: 0, row: 0, sizeX: 6, sizeY: 15 } } },
]
const saved: Layout = [{ i: '113', x: 0, y: 0, w: 6, h: 15 }]
const resized: Layout = [{ i: '113', x: 0, y: 0, w: 4, h: 15 }]

function gridProps(): GridProps {
  if (!grid.props) throw new Error('the grid did not render')
  return grid.props
}

beforeEach(() => {
  grid.width = 1200
  grid.props = null
})

describe('DashboardGrid saving', () => {
  it('hands the grid no layout-change callback, so loading, reloading and narrowing never save', () => {
    render(<DashboardGrid widgets={widgets} isEditing={false} onPositionsChange={vi.fn()} />)

    expect(gridProps().onLayoutChange).toBeUndefined()
  })

  it('ignores a drag stop outside an edit session', () => {
    const onPositionsChange = vi.fn()
    render(<DashboardGrid widgets={widgets} isEditing={false} onPositionsChange={onPositionsChange} />)

    gridProps().onResizeStop?.(resized)

    expect(onPositionsChange).not.toHaveBeenCalled()
  })

  it('saves a resize made while editing', () => {
    const onPositionsChange = vi.fn()
    render(<DashboardGrid widgets={widgets} isEditing onPositionsChange={onPositionsChange} />)

    gridProps().onResizeStop?.(resized)

    expect(onPositionsChange).toHaveBeenCalledWith([{ id: 113, col: 0, row: 0, sizeX: 4, sizeY: 15 }])
  })

  it('saves nothing when a drag ends where it started', () => {
    const onPositionsChange = vi.fn()
    render(<DashboardGrid widgets={widgets} isEditing onPositionsChange={onPositionsChange} />)

    gridProps().onDragStop?.(saved)

    expect(onPositionsChange).not.toHaveBeenCalled()
  })

  it('never saves the single-column layout of a narrow window', () => {
    grid.width = WIDE_LAYOUT_MIN_WIDTH - 1
    const onPositionsChange = vi.fn()
    render(<DashboardGrid widgets={widgets} isEditing onPositionsChange={onPositionsChange} />)

    gridProps().onResizeStop?.([{ i: '113', x: 0, y: 0, w: 1, h: 15 }])

    expect(onPositionsChange).not.toHaveBeenCalled()
  })
})
