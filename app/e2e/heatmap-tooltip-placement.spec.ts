import { expect, test } from '@playwright/test'
import { authorLongLabelHeatmap, authorTallLongLabelHeatmap } from './heatmap-interaction-helpers'
import { TOOLTIP_HALF_WIDTH } from '../src/components/visualizations/use-heatmap-tooltip'

// Task 5 fix rounds 4 and 5: the tooltip's own GEOMETRY, split out of
// heatmap-interaction.spec.ts (already at the file-size hook's limit) because
// it is its own seam and needs its own fixture. Every other spec in this suite
// runs against categories eight or so characters long, which makes the
// tooltip one line and hides both bugs these tests cover. Query 8's hour
// column carries raw datetime strings, so a cell's description runs to
// "2026-03-18T00:00:00 / Clear: 59.70" and the tooltip is genuinely two lines
// at its capped width.

test('a long category label neither widens the tooltip past the clamp constant nor pushes it off screen', async ({
  page,
}) => {
  // The width bound in heatmap-interaction.spec.ts rides on ACTIVE's short
  // label ("Accident / Major: 36"). With whitespace-nowrap and no max-width, that bound was a
  // property of the fixture, not of the tooltip: a longer category name
  // widened the tooltip without limit, and TOOLTIP_HALF_WIDTH (which
  // positionTooltip clamps the horizontal anchor by, so an edge cell's
  // tooltip stays on screen) stopped being half the real width, which is the
  // one thing that constant has to be. This fixture's categories are raw
  // datetime strings, so its labels are long enough to show the difference.
  await authorLongLabelHeatmap(page)
  const cell = page.locator('[role="gridcell"]').first()
  const label = await cell.getAttribute('aria-label')
  expect(label).not.toBeNull()
  await cell.focus()
  const tooltip = page.locator('[role="tooltip"]')
  await expect(tooltip).toHaveText(label as string)

  // What makes this fixture a real test of the bound rather than another
  // short label: the very same tooltip, unbounded and non-wrapping, measures
  // WIDER than the clamp allows. Measured off a clone of the live tooltip, so
  // it carries the real font, padding and border rather than a guess at them.
  const naturalWidth = await tooltip.evaluate((el) => {
    const probe = el.cloneNode(true) as HTMLElement
    probe.style.maxWidth = 'none'
    probe.style.whiteSpace = 'nowrap'
    probe.style.left = '-9999px'
    probe.style.top = '0px'
    document.body.appendChild(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  })
  expect(naturalWidth).toBeGreaterThan(2 * TOOLTIP_HALF_WIDTH)

  const viewport = page.viewportSize()
  if (!viewport) throw new Error('[heatmap-interaction] no viewport size')
  const box = await tooltip.boundingBox()
  if (!box) throw new Error('[heatmap-interaction] tooltip had no box')
  const seen = JSON.stringify({ box, naturalWidth, label })
  expect(box.width, seen).toBeLessThanOrEqual(2 * TOOLTIP_HALF_WIDTH)
  expect(box.height, seen).toBeGreaterThan(0)
  expect(box.x, seen).toBeGreaterThanOrEqual(0)
  expect(box.y, seen).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, seen).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height, seen).toBeLessThanOrEqual(viewport.height)
})

test('a two-line tooltip on a near-top cell is placed below it, not clipped off the top of the screen', async ({
  page,
}) => {
  // Placement used to flip to "above" whenever the cell's top cleared a
  // single constant (48). An above-placed tooltip renders with
  // translateY(-100%), so its visual top is the cell's top minus the gap
  // minus its own height: 48 was exactly right for the 38px single line the
  // tooltip used to be, and wrong the moment capping its width let a long
  // label wrap to two lines and about 58px. A cell whose top lands just past
  // that constant then gets a tooltip clipped off the top of the viewport,
  // which is the failure the portal was introduced for in the first place.
  // The TALL long-label fixture, not the wide one: the wide fixture's single
  // row sits 269px down the page and the page never scrolls far enough to
  // lift it into the band this test needs (measured across viewport heights
  // from 720 down to 240, the most scroll available was 137px). This one has
  // about 36 rows of 40px cells, so any cell can be put at any offset.
  await authorTallLongLabelHeatmap(page)

  // Task 6 bounded the grid wrapper's height, which is what lets its column
  // headers stick (see e2e/heatmap-sticky-headers.spec.ts). Two things follow
  // for this test, and neither is a reason to opt out of the shipped geometry:
  //
  // The page now has only a few hundred pixels of scroll, and the sticky header
  // band occupies the first ~24px of the scrollport, so the closest a HOVERABLE
  // cell gets to the viewport top at the default 720px viewport is 174 (a cell
  // any nearer than that is behind the header band, where a hover would hit the
  // header instead). A short viewport gets it back: at 300px the wrapper's own
  // top sits at y=22, which puts the first visible row inside the band this
  // test needs. So the viewport shrinks and the component's own bound stands.
  //
  // Positioning is now a two-step move, because two elements scroll: the page
  // puts the wrapper near the viewport top, then the wrapper's own scrollTop
  // puts a chosen cell at TARGET_TOP.
  await page.setViewportSize({ width: 1280, height: 300 })

  const scrollable = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
  expect(scrollable.scrollHeight, JSON.stringify(scrollable)).toBeGreaterThan(scrollable.clientHeight + 100)

  // Well into the grid, not near its start. The fixture is 48 columns wide, so
  // a low index names a cell in the FIRST row, whose top cannot be pushed down
  // to the target at all: at scrollTop 0 it already sits as low as it goes
  // (measured at 48, just under the sticky band), and the wrapper cannot scroll
  // backwards past zero. A cell ten rows in can be placed anywhere.
  const CELL_INDEX = 500
  const TARGET_TOP = 55
  const cell = page.locator('[role="gridcell"]').nth(CELL_INDEX)
  const label = await cell.getAttribute('aria-label')
  expect(label).not.toBeNull()

  const placed = await page.evaluate(
    ({ index, target }) => {
      const grid = document.querySelector('[role="grid"]') as HTMLElement
      const scroller = grid.parentElement as HTMLElement
      // Page first: scroll it to the end so the wrapper rides as high as it can.
      window.scrollTo(0, document.documentElement.scrollHeight)
      const headerBottom = grid
        .querySelectorAll('[role="columnheader"]')[1]
        .getBoundingClientRect().bottom
      // Then the wrapper, to land the cell exactly on target.
      const el = document.querySelectorAll('[role="gridcell"]')[index] as HTMLElement
      scroller.scrollTop += el.getBoundingClientRect().top - target
      return { scrollerTop: scroller.getBoundingClientRect().top, headerBottom, scrollTop: scroller.scrollTop }
    },
    { index: CELL_INDEX, target: TARGET_TOP }
  )
  // The target has to sit BELOW the sticky header band, or the cell is behind
  // it and the hover below would land on the header instead of the cell.
  expect(TARGET_TOP, JSON.stringify(placed)).toBeGreaterThanOrEqual(placed.headerBottom)

  const rect = await cell.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height }
  })
  // The band the old constant got wrong: past 48, so it called this "room
  // enough above", but nowhere near enough for two lines.
  expect(rect.top, JSON.stringify(rect)).toBeGreaterThan(48)
  expect(rect.top, JSON.stringify(rect)).toBeLessThanOrEqual(70)

  await page.mouse.move(rect.left + rect.width / 2, rect.top + rect.height / 2)
  const tooltip = page.locator('[role="tooltip"]')
  await expect(tooltip).toHaveText(label as string)

  const box = await tooltip.boundingBox()
  if (!box) throw new Error('[heatmap-tooltip-placement] tooltip had no box')
  const seen = JSON.stringify({ rect, box })
  // What makes this fixture the real case rather than another near-top cell:
  // the tooltip is genuinely taller than the room above the cell, so an
  // above placement could not have fitted.
  expect(box.height, seen).toBeGreaterThan(rect.top)
  // Below the cell, and fully on screen.
  expect(box.y, seen).toBeGreaterThanOrEqual(rect.bottom)
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('[heatmap-tooltip-placement] no viewport size')
  expect(box.y + box.height, seen).toBeLessThanOrEqual(viewport.height)
})
