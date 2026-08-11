import { expect, test } from '@playwright/test'
import {
  ACTIVE,
  CELL_LABEL_RE,
  NEXT_COLUMN,
  NEXT_ROW,
  SAME_COL,
  SAME_ROW,
  UNRELATED,
  activeElementLabel,
  authorHeatmap,
  boxShadow,
} from './heatmap-interaction-helpers'
import { TOOLTIP_HALF_WIDTH } from '../src/components/visualizations/use-heatmap-tooltip'

// Task 5: a heatmap cell's value must be reachable from the keyboard and
// announced to assistive tech, not just readable by a mouse hovering long
// enough for the native `title` tooltip to appear. jsdom cannot see any of
// this: real focus order, real hover, the real computed box-shadow the
// row/column ring paints, the real computed accessible name (not just the
// aria-label attribute), and whether an element is actually painted where
// its own getBoundingClientRect says it is, are all layout and paint, which
// is exactly what a unit test cannot observe (see chart-theme-tokens.spec.ts's
// own note on the same limitation). This spec authors a Heatmap
// visualization against the existing "Traffic Incidents This Week" query
// (id 4) live in the mock pack's own UI, rather than adding a fixture
// heatmap to the mock dashboards, so it needs no changes to mock data at all.
// Shared setup/fixtures live in ./heatmap-interaction-helpers.ts.

test('heatmap cell: reachable, correctly named, positioned, and highlighted, all measured for real', async ({
  page,
}) => {
  await authorHeatmap(page)
  const activeCell = page.getByLabel(ACTIVE, { exact: true })
  await expect(activeCell).toBeVisible()

  // --- Grid semantics: the ROLE actually resolves to gridcell, not just ----
  // --- the aria-label attribute being present ---------------------------
  // getByLabel (like Testing Library's getByLabelText in the jsdom tests)
  // matches the aria-label ATTRIBUTE directly, which passes whether or not
  // the element has a role at all. getByRole('gridcell', { name }) is the
  // assertion that depends on the role: it resolves each element's role via
  // Playwright's own DOM-side reimplementation of the ARIA role-resolution
  // algorithm (not a read of Chromium's native accessibility tree), and
  // verified directly (see this task's report for the transcript) that
  // without role="gridcell" this locator matches ZERO elements, even though
  // the aria-label attribute is right there on the same element, because
  // Playwright resolves an unstyled div with no role attribute to
  // role=generic, not gridcell. toHaveAccessibleName is also asserted below
  // for the name text itself, but on its own it is NOT the discriminating
  // check here: verified (again, see the report) that Chromium's own native
  // accessibility tree, read directly over CDP, computes a name from
  // aria-label on a bare, roleless div too in this browser version, so that
  // specific assertion would have passed even against the unfixed markup.
  // getByRole('gridcell', ...) is the one that actually depends on the role
  // fix, and the regression it guards against (the role attribute being
  // removed again) is real regardless of what a screen reader's own AX-tree
  // consumption ultimately does with it.
  await expect(page.getByRole('gridcell', { name: ACTIVE, exact: true })).toHaveCount(1)
  await expect(activeCell).toHaveAccessibleName(ACTIVE)
  await expect(page.getByRole('grid')).toBeVisible()
  expect(await activeCell.getAttribute('role')).toBe('gridcell')

  // --- Roving tabIndex: reachable, but as exactly one Tab stop -------------
  // A real keyboard Tab walk reaches a heatmap cell: repeatedly press Tab
  // from the Heatmap tab trigger (the last thing clicked above) and stop the
  // first time document.activeElement carries a heatmap-shaped aria-label.
  // Bounded rather than a hardcoded press count, since the exact number of
  // intervening stops (the tab's own "..." menu button, etc.) is an
  // implementation detail of the surrounding page, not of the grid.
  let reachedCell: string | null = null
  for (let i = 0; i < 10 && !reachedCell; i++) {
    await page.keyboard.press('Tab')
    const label = await activeElementLabel(page)
    reachedCell = label && CELL_LABEL_RE.test(label) ? label : null
  }
  expect(reachedCell).toBe(ACTIVE)

  // Exactly one gridcell carries tabIndex=0 at any time: with tabIndex={0}
  // on every cell instead, a keyboard user needed one Tab press per cell to
  // get past this 8-cell grid, and the 150-cell density threshold this
  // project's own model tests exercise proves grids that size are expected.
  const tabbableCells = page.locator('[role="gridcell"][tabindex="0"]')
  await expect(tabbableCells).toHaveCount(1)
  await expect(tabbableCells.first()).toHaveAccessibleName(ACTIVE)

  // Arrow keys move the roving stop, in the real browser: ArrowRight moves
  // within the row (Accident -> Road Work, same "Major" severity), ArrowDown
  // then moves within the column (Major -> Minor, same "Road Work" category).
  await page.keyboard.press('ArrowRight')
  expect(await activeElementLabel(page)).toBe(NEXT_COLUMN)
  await expect(tabbableCells).toHaveCount(1)
  await expect(page.getByLabel(NEXT_COLUMN, { exact: true })).toHaveAttribute('tabindex', '0')
  await expect(activeCell).toHaveAttribute('tabindex', '-1')

  await page.keyboard.press('ArrowDown')
  expect(await activeElementLabel(page)).toBe(NEXT_ROW)
  await expect(tabbableCells).toHaveCount(1)

  // Tab, not another arrow key, now leaves the grid entirely: with only ONE
  // cell ever a Tab stop, a single Tab (not the whole remaining grid) is
  // enough to prove it, unlike the old tabIndex={0}-on-every-cell shape
  // where leaving the grid needed one Tab per remaining cell.
  await page.keyboard.press('Tab')
  const leftLabel = await activeElementLabel(page)
  expect(leftLabel === null || !CELL_LABEL_RE.test(leftLabel)).toBe(true)

  // Tab back in: roving tabIndex remembers where focus left off (Road Work /
  // Minor), not the grid's first cell again.
  await page.keyboard.press('Shift+Tab')
  expect(await activeElementLabel(page)).toBe(NEXT_ROW)

  // Back to ACTIVE for the rest of this test.
  await activeCell.focus()
  expect(await activeElementLabel(page)).toBe(ACTIVE)

  // --- Tooltip and highlight on keyboard focus ------------------------------
  const tooltip = page.locator('[role="tooltip"]')
  await expect(tooltip).toHaveText(ACTIVE)
  await expect(tooltip).toHaveAttribute('aria-hidden', 'true')

  const sameRowCell = page.getByLabel(SAME_ROW, { exact: true })
  const sameColCell = page.getByLabel(SAME_COL, { exact: true })
  const unrelatedCell = page.getByLabel(UNRELATED, { exact: true })

  const activeShadowFocused = await boxShadow(activeCell)
  const sameRowShadowFocused = await boxShadow(sameRowCell)
  const sameColShadowFocused = await boxShadow(sameColCell)
  const unrelatedShadowFocused = await boxShadow(unrelatedCell)

  expect(activeShadowFocused).not.toBe('none')
  expect(sameRowShadowFocused).not.toBe('none')
  expect(sameColShadowFocused).not.toBe('none')
  expect(unrelatedShadowFocused).toBe('none')
  // The active cell's own ring (ring-2) is visibly heavier than the row/column
  // band's ring (ring-1) on the cells merely sharing its row or column, and
  // the row cell and column cell (which share only the "in this row or
  // column" state, nothing else) paint identically.
  expect(activeShadowFocused).not.toBe(sameRowShadowFocused)
  expect(sameRowShadowFocused).toBe(sameColShadowFocused)

  // --- The tooltip is not clipped, and actually has a real, on-screen box --
  // ACTIVE is a first-row cell, which is exactly the shape that clipped
  // against the grid's `overflow-auto` scroll wrapper before this fix round:
  // a first-row cell has roughly 2.5rem of height above it but only 1rem of
  // scroll-wrapper padding plus the column-header row, so a tooltip
  // positioned `absolute bottom-full` INSIDE that wrapper had nowhere near
  // enough room and was cut off. toHaveText above reads textContent and
  // toBeVisible only checks the element's own box model, neither of which
  // can see an overflow clip: a clipped element still has a non-zero
  // bounding rect. document.elementFromPoint cannot be used to check this
  // either, since the tooltip is deliberately `pointer-events: none` (so it
  // never blocks a click on whatever is under it) and elementFromPoint skips
  // pointer-events:none elements entirely, always reporting whatever is
  // beneath as "the element at that point" whether or not the tooltip is
  // actually clipped.
  //
  // An earlier version of this check walked the tooltip's own ancestor chain
  // for an `overflow: hidden|auto|scroll` box. That became unfalsifiable the
  // moment the tooltip was portaled to <body>: the grid's scroll wrapper is
  // then never an ancestor at all, so the walk finds nothing and reports
  // "not clipped" whether the tooltip is correctly placed, zero-sized, or
  // parked at `top: -1000`. The actual invariant a portaled, fixed-position
  // tooltip has to satisfy: its own rect is non-zero in both dimensions AND
  // fully inside the viewport.
  //
  // ACTIVE's cell sits well inside the page, so the horizontal clamp
  // (rawLeft floored/ceilinged to TOOLTIP_HALF_WIDTH from either edge) never
  // actually engages here: rawLeft never gets close enough to an edge to
  // need it. Pinning the tooltip's own rendered width against
  // 2 * TOOLTIP_HALF_WIDTH at least keeps the CONSTANT honest (it is meant
  // to be at least half this tooltip's real width, so the clamp, when it
  // does engage for an edge cell, cannot itself push the tooltip back off
  // the opposite edge); it does not exercise the clamp's own branch, which
  // would need a cell in the first or last column instead.
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('[heatmap-interaction] no viewport size')
  const tooltipBox = await tooltip.boundingBox()
  if (!tooltipBox) throw new Error('[heatmap-interaction] tooltip had no box')
  expect(tooltipBox.width, JSON.stringify(tooltipBox)).toBeGreaterThan(0)
  expect(tooltipBox.height, JSON.stringify(tooltipBox)).toBeGreaterThan(0)
  expect(tooltipBox.width).toBeLessThanOrEqual(2 * TOOLTIP_HALF_WIDTH)
  expect(tooltipBox.x).toBeGreaterThanOrEqual(0)
  expect(tooltipBox.y).toBeGreaterThanOrEqual(0)
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width)
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewport.height)

  // --- Highlight follows focus as it moves, and clears once focus leaves ---
  await page.keyboard.press('ArrowRight')
  const nextCell = page.getByLabel(NEXT_COLUMN, { exact: true })
  await expect(nextCell).toBeFocused()
  await expect(tooltip).not.toHaveText(ACTIVE)
  await expect(tooltip).toHaveText(NEXT_COLUMN)
  expect(await boxShadow(activeCell)).not.toBe(activeShadowFocused)
  expect(await boxShadow(nextCell)).toBe(activeShadowFocused)
  // Closure/Major (SAME_ROW) shares "Major" with BOTH the old and new active
  // cell, so its own light ring is unchanged by focus moving between them.
  expect(await boxShadow(sameRowCell)).toBe(sameRowShadowFocused)

  await page.keyboard.press('Tab')
  await expect(tooltip).toHaveCount(0)

  // --- Tooltip and highlight on mouse hover, independent of focus ----------
  await activeCell.hover()
  await expect(tooltip).toHaveText(ACTIVE)
  expect(await boxShadow(activeCell)).toBe(activeShadowFocused)
  expect(await boxShadow(sameColCell)).toBe(sameColShadowFocused)
  expect(await boxShadow(unrelatedCell)).toBe('none')

  await unrelatedCell.hover()
  await expect(tooltip).toHaveText(UNRELATED)
  expect(await boxShadow(activeCell)).toBe('none')
})
