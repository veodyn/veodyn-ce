import { expect, test, type Page } from '@playwright/test'
import { ACTIVE, SAME_COL, authorHeatmap, boxShadow } from './heatmap-interaction-helpers'

// Split out of heatmap-interaction.spec.ts once the theme-toggle case pushed
// that file over the file-size hook's limit: a real seam (dynamic re-painting
// over TIME, not the single static reachability/positioning/highlight pass the
// other file covers), not a forced split. Shared setup/fixtures live in
// ./heatmap-interaction-helpers.ts. Scrolling, which is also dynamic, needs
// fixtures that genuinely overflow and lives in
// heatmap-interaction-scroll.spec.ts instead.

// Resolves a design token to the same rgb() form getComputedStyle reports for
// a painted element, by reading it off a throwaway element that inherits the
// active theme scope. Lets the ink assertions below name the TOKEN they mean
// instead of pasting the literal rgb() triple globals.css happens to compile
// to today, which would fail on a palette change for a reason unrelated to
// what those assertions are about.
async function resolvedToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.position = 'absolute'
    probe.style.visibility = 'hidden'
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, token)
}

test('a theme change repaints the cells, and actually flips a cell whose ink crossover moves', async ({ page }) => {
  // Toggling `.dark` on document.documentElement directly, rather than
  // clicking a theme control this app does not have wired up yet, is the
  // same signal useThemeTokenVersion's MutationObserver watches for
  // (attributeFilter: ['class', 'data-theme']).
  //
  // colorFor (backgroundColor, checked below) is a real-browser smoke check,
  // not a discriminating regression test: getSequentialScale's returned
  // string is a live CSS color-mix()/var() expression, not a resolved
  // value, so the browser re-resolves it on any theme change regardless of
  // whether colorFor's memo was ever invalidated (verified directly:
  // temporarily reverted the memo dependency and re-ran this exact
  // assertion, it still passed).
  //
  // inkFor (color, checked on SAME_COL below) IS discriminating.
  // getSequentialInk resolves --card/--foreground/--chart-1 once, at
  // factory-call time, to choose which of those two variables has better
  // contrast against the ramp colour, then bakes that CHOICE into the
  // returned closure; the choice can go stale even though whichever
  // variable it returns still paints live. SAME_COL ("Accident / Minor:
  // 112") is this dataset's max-value cell (min=12, max=112 across the 5
  // populated cells), so it normalizes to exactly 100% and its ramp colour
  // is bare --chart-1 with no --card blended in; computed independently
  // against the real tokens in globals.css (contrast()/hexToOklab() from
  // chart-palette.ts), light and dark land on OPPOSITE sides of the
  // resulting contrast crossover for that exact colour: light picks
  // var(--card), dark picks var(--foreground). Both tokens are read from the
  // page below rather than pasted in as rgb() literals, and the assertion
  // that the two differ under each theme is what keeps "it picked the right
  // one" from being satisfiable by either.
  await authorHeatmap(page)
  const activeCell = page.getByLabel(ACTIVE, { exact: true })
  await expect(activeCell).toBeVisible()
  const sameColCell = page.getByLabel(SAME_COL, { exact: true })

  const lightCard = await resolvedToken(page, '--card')
  const lightForeground = await resolvedToken(page, '--foreground')
  expect(lightCard).not.toBe(lightForeground)

  const lightBackground = await activeCell.evaluate((el) => getComputedStyle(el).backgroundColor)
  const lightInk = await sameColCell.evaluate((el) => getComputedStyle(el).color)
  expect(lightInk).toBe(lightCard)

  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const darkCard = await resolvedToken(page, '--card')
  const darkForeground = await resolvedToken(page, '--foreground')
  expect(darkCard).not.toBe(darkForeground)

  // The MutationObserver callback (and the resulting re-render) is
  // asynchronous relative to the class mutation itself; poll rather than
  // read once immediately after.
  await expect
    .poll(() => activeCell.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(lightBackground)
  await expect.poll(() => sameColCell.evaluate((el) => getComputedStyle(el).color)).toBe(darkForeground)

  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await expect
    .poll(() => activeCell.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe(lightBackground)
  await expect.poll(() => sameColCell.evaluate((el) => getComputedStyle(el).color)).toBe(lightInk)
})

test('a viewport resize closes the tooltip without dropping the focus ring', async ({ page }) => {
  // Round 3 fixed the scroll listener to spare the ring but left resize
  // clearing activeCell, which drives both the ring and the tooltip. DOM
  // focus is untouched by a resize, so opening devtools, zooming the browser
  // or rotating a device left a focused cell with no visible focus indicator
  // at all (WCAG 2.4.7): the same defect the scroll fix closed, on a narrower
  // trigger. The ring is a box-shadow on the cell's own box, so a reflow
  // carries it along exactly as a scroll does; only the portaled,
  // fixed-position tooltip goes stale and has to close.
  await authorHeatmap(page)
  await page.mouse.move(0, 0)
  const activeCell = page.getByLabel(ACTIVE, { exact: true })
  await activeCell.focus()
  const tooltip = page.locator('[role="tooltip"]')
  await expect(tooltip).toHaveText(ACTIVE)
  expect(await boxShadow(activeCell)).not.toBe('none')

  const before = page.viewportSize()
  if (!before) throw new Error('[heatmap-interaction] no viewport size')
  await page.setViewportSize({ width: before.width - 220, height: before.height - 120 })

  await expect(tooltip).toHaveCount(0)
  await expect(activeCell).toBeFocused()
  expect(await boxShadow(activeCell)).not.toBe('none')
})
