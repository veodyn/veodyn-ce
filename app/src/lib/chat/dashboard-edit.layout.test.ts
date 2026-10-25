import { describe, expect, it } from 'vitest'
import { overlaps, resolve } from './dashboard-edit.fixtures'

const MOVED_TO_THE_AUTO_SPOT = { col: 3, row: 4, sizeX: 3, sizeY: 4 }

describe('resolveDashboardEdit: the final layout', () => {
  it('places an add without a position around where a move in the same edit ends up', async () => {
    const result = await resolve({
      operations: [
        { op: 'add', queryId: 7, visualizationId: 70 },
        { op: 'move', widgetId: 2, position: MOVED_TO_THE_AUTO_SPOT },
      ],
    })
    expect(result.problems).toEqual([])
    const added = result.operations?.[0].position
    expect(added).not.toEqual({ col: 3, row: 4, sizeX: 3, sizeY: 6 })
    expect(overlaps(added ?? {}, MOVED_TO_THE_AUTO_SPOT)).toBe(false)
    expect(overlaps(added ?? {}, { col: 0, row: 0, sizeX: 3, sizeY: 8 })).toBe(false)
  })

  it('refuses a move onto another widget and names both', async () => {
    const result = await resolve({
      operations: [{ op: 'move', widgetId: 2, position: { col: 0, row: 0, sizeX: 3, sizeY: 4 } }],
    })
    expect(result.operations).toEqual([])
    expect(result.problems).toEqual([
      '## Notes at col 0, row 0 overlaps Query 1 · Chart 1; pick another position or leave it out to place it automatically.',
    ])
  })

  it('refuses an add with an explicit position onto an existing widget', async () => {
    const result = await resolve({
      operations: [{ op: 'addText', text: 'Footer', position: { col: 2, row: 0, sizeX: 2, sizeY: 2 } }],
    })
    expect(result.problems).toHaveLength(1)
    expect(result.problems?.[0]).toMatch(/^Text: Footer at col 2, row 0 overlaps /)
  })

  it('refuses two explicit positions that overlap each other once', async () => {
    const position = { col: 0, row: 20, sizeX: 2, sizeY: 2 }
    const result = await resolve({
      operations: [
        { op: 'addText', text: 'One', position },
        { op: 'addText', text: 'Two', position },
      ],
    })
    expect(result.problems).toHaveLength(1)
  })

  it('allows a move into a cell a remove in the same edit frees', async () => {
    const result = await resolve({
      operations: [
        { op: 'move', widgetId: 2, position: { col: 0, row: 0, sizeX: 3, sizeY: 4 } },
        { op: 'remove', widgetId: 1 },
      ],
    })
    expect(result.problems).toEqual([])
    expect(result.operations).toHaveLength(2)
  })

  it('allows a move into the cell another widget vacates by moving', async () => {
    const result = await resolve({
      operations: [
        { op: 'move', widgetId: 2, position: { col: 0, row: 0, sizeX: 3, sizeY: 4 } },
        { op: 'move', widgetId: 1, position: { col: 3, row: 0, sizeX: 3, sizeY: 8 } },
      ],
    })
    expect(result.problems).toEqual([])
  })
})
