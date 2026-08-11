import { describe, expect, it } from 'vitest'
import { computeTooltipPosition, TOOLTIP_HALF_WIDTH } from './use-heatmap-tooltip'

// Task 5 fix round 5. Placement used to flip to 'above' whenever the cell's
// top cleared a single constant (48), which silently encoded one specific
// tooltip height: a single line is 38px, and 38 + the 8px gap is 46, so 48
// was right until capping the tooltip's width let a long label wrap to two
// lines and about 58px. At that height a cell whose top sits just past the
// constant gets an above-placed tooltip whose visual top is negative, clipped
// off the viewport, which is the exact failure the portal was introduced for.
//
// These assert the rule directly, as input/output, so the clipping case is
// pinned without needing a browser to reproduce a cell at one particular
// scroll offset. The e2e suite pins the same case for real.

const VIEWPORT_WIDTH = 1280
const VIEWPORT_HEIGHT = 720

// A cell 40px tall whose top sits in the band that the old constant called
// "room enough above": 55 > 48, but 55 is not enough room for a two-line
// tooltip plus its gap.
const NEAR_TOP_CELL = { top: 55, bottom: 95, left: 400, width: 40 }

// The visual top of an above-placed tooltip: it renders with
// translateY(-100%), so its box extends upward from the returned top.
function visualTop(placement: 'above' | 'below', top: number, height: number): number {
  return placement === 'above' ? top - height : top
}

describe('computeTooltipPosition', () => {
  it('places a one-line tooltip above a cell that has room for one line', () => {
    const placed = computeTooltipPosition(NEAR_TOP_CELL, 38, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
    expect(placed.placement).toBe('above')
    expect(visualTop(placed.placement, placed.top, 38)).toBeGreaterThanOrEqual(0)
  })

  it('places a two-line tooltip BELOW the same cell, which has no room for two', () => {
    // Same cell, same viewport, only the measured height differs. Under a
    // constant clearance both of these come back 'above', and this one is
    // then clipped off the top of the screen.
    const placed = computeTooltipPosition(NEAR_TOP_CELL, 58, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
    expect(placed.placement).toBe('below')
    expect(visualTop(placed.placement, placed.top, 58)).toBeGreaterThanOrEqual(0)
    expect(placed.top + 58).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
  })

  it('keeps a tooltip of any height on screen for a cell anywhere down the viewport', () => {
    // The property the two cases above are instances of, swept rather than
    // spot-checked: for every cell position and every plausible tooltip
    // height, the placed box is fully inside the viewport.
    for (let top = 0; top <= VIEWPORT_HEIGHT - 40; top += 5) {
      for (const height of [38, 58, 78, 120]) {
        const cell = { top, bottom: top + 40, left: 400, width: 40 }
        const placed = computeTooltipPosition(cell, height, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
        const boxTop = visualTop(placed.placement, placed.top, height)
        const seen = JSON.stringify({ cell, height, placed })
        expect(boxTop, seen).toBeGreaterThanOrEqual(0)
        expect(boxTop + height, seen).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
      }
    }
  })

  it('prefers above when both sides fit, so the tooltip does not cover the row below', () => {
    const middle = { top: 300, bottom: 340, left: 400, width: 40 }
    expect(computeTooltipPosition(middle, 38, VIEWPORT_WIDTH, VIEWPORT_HEIGHT).placement).toBe('above')
  })

  it('takes the roomier side when a tooltip fits on neither', () => {
    // Only reachable with a tooltip taller than the room on both sides of the
    // cell. Something has to be clipped; clipping less of it is the answer.
    const tall = { top: 300, bottom: 340, left: 400, width: 40 }
    expect(computeTooltipPosition(tall, 600, VIEWPORT_WIDTH, VIEWPORT_HEIGHT).placement).toBe('below')
    const lower = { top: 500, bottom: 540, left: 400, width: 40 }
    expect(computeTooltipPosition(lower, 600, VIEWPORT_WIDTH, VIEWPORT_HEIGHT).placement).toBe('above')
  })

  it('clamps the horizontal anchor so an edge cell tooltip cannot hang off either side', () => {
    const leftEdge = { top: 300, bottom: 340, left: 0, width: 40 }
    expect(computeTooltipPosition(leftEdge, 38, VIEWPORT_WIDTH, VIEWPORT_HEIGHT).left).toBe(TOOLTIP_HALF_WIDTH)

    const rightEdge = { top: 300, bottom: 340, left: VIEWPORT_WIDTH - 40, width: 40 }
    expect(computeTooltipPosition(rightEdge, 38, VIEWPORT_WIDTH, VIEWPORT_HEIGHT).left).toBe(
      VIEWPORT_WIDTH - TOOLTIP_HALF_WIDTH
    )
  })

  it('centers on the cell when the clamp does not engage', () => {
    const middle = { top: 300, bottom: 340, left: 400, width: 40 }
    expect(computeTooltipPosition(middle, 38, VIEWPORT_WIDTH, VIEWPORT_HEIGHT).left).toBe(420)
  })
})
