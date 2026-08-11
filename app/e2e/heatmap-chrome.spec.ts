import { expect, test } from '@playwright/test'
import { authorTallHeatmap } from './heatmap-interaction-helpers'

// The chrome around the grid: the row-header gutter, and the legend under it.
// All three assertions here are layout facts, which is why they live in a
// browser spec: jsdom computes no boxes, so the unit suite cannot tell a
// two-line label from a nineteen-line one, and could not see either of the
// defects this pins.
//
// authorTallHeatmap is the six-column fixture on purpose. A wide one (24 hour
// columns) over-constrains the grid, every `1fr` cell column sits at its floor,
// and the row-header track collapses to ITS floor no matter what the labels
// say, so the growth case below never happens there.
test('the row-header gutter is padded, bounded, and wraps a long label', async ({ page }) => {
  await authorTallHeatmap(page)

  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  const header = grid.getByRole('rowheader').first()

  // Padded on both sides. Right-aligned text with padding on the right only put
  // a long label flush against the left edge of the card.
  const padding = await header.evaluate((el) => {
    const style = getComputedStyle(el)
    return { left: style.paddingLeft, right: style.paddingRight }
  })
  expect(padding).toEqual({ left: '8px', right: '8px' })

  // Sized to its content while that content is short: the gutter is a floor and
  // a ceiling, not a fixed width.
  const short = await header.evaluate((el) => el.getBoundingClientRect().width)
  expect(short).toBeGreaterThan(64)
  expect(short).toBeLessThan(192)

  // A label longer than any fixture carries. The report that prompted this came
  // from real data ("Downtown Santa Monica E Line Station (North)"), whose
  // gutter took 265px and whose text ran into the card's border.
  const long = await header.evaluate((el) => {
    const label = el.querySelector('span')
    if (!label) throw new Error('the row header has no label span')
    label.textContent = 'Downtown Santa Monica E Line Station (North)'
    const style = getComputedStyle(label)
    return {
      cellWidth: Math.round(el.getBoundingClientRect().width),
      labelHeight: Math.round(label.getBoundingClientRect().height),
      lineHeight: parseFloat(style.lineHeight),
      overflowsRight: el.scrollWidth > el.clientWidth + 1,
    }
  })

  // Capped at max-w-48, so one long name cannot decide the whole grid's width.
  expect(long.cellWidth).toBe(192)
  // And bounded to two lines rather than growing the row. The clamp this
  // replaced needed display:-webkit-box, which a grid item blockifies away.
  expect(long.labelHeight).toBe(long.lineHeight * 2)
  expect(long.overflowsRight).toBe(false)
})

test('the legend lines up with the grid and clears the last row', async ({ page }) => {
  await authorTallHeatmap(page)

  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  const gradient = page.getByTestId('heatmap-legend-gradient')
  const legendRow = page.locator('div:has(> [data-testid=heatmap-legend-gradient])').first()
  const valueLabel = legendRow.locator('span').first()

  const gridBox = await grid.boundingBox()
  const labelBox = await valueLabel.boundingBox()
  const rowBox = await legendRow.boundingBox()
  const gradientBox = await gradient.boundingBox()
  if (!gridBox || !labelBox || !rowBox || !gradientBox) throw new Error('the heatmap did not render')

  // The value label sits INSIDE the grid's left edge. As a sibling of the row
  // holding the rotated y-axis title, the legend started at the card's edge
  // instead, so its label sat under that title and read as having escaped the
  // plot at the corner.
  expect(labelBox.x).toBeGreaterThanOrEqual(gridBox.x)
  expect(labelBox.x).toBeLessThan(gridBox.x + 32)

  // And the bar clears the grid above it rather than sitting against the last
  // row of cells.
  expect(gradientBox.y - rowBox.y).toBeGreaterThanOrEqual(8)
})
