import { expect, test, type Page } from '@playwright/test'

// Validated palette columns, copied from config-schema.ts's DEFAULT_PALETTE
// and DEFAULT_PALETTE_DARK (validated by chart-palette.test.ts). Copied, not
// imported: this spec runs against a real browser process, checking what the
// cascade actually resolves to, not what the source module says it should
// be. Update both places together if the palette changes.
const LIGHT_COLUMN = ['#485EA7', '#2B7E4E', '#A37AC7', '#3570A2', '#89435E', '#BF8A32', '#1D9999', '#B25630']
const DARK_COLUMN = ['#4A61AA', '#2B7E4E', '#754998', '#4D8FC8', '#A05771', '#BF861D', '#1D9999', '#B55933']

// Slots where the dark column differs from the light one. Slot index 1 (the
// green) is shared by design, so it is not useful evidence that dark mode is
// active; excluded here so the "not the light color" checks below only rely
// on slots that would actually catch a regression to the light palette.
const LIGHT_HEXES_DISTINCT_FROM_DARK = LIGHT_COLUMN.filter((hex, i) => hex !== DARK_COLUMN[i])

// Mirrors the helper in e2e/baseline.spec.ts and
// e2e/data-catalog.spec.ts.
async function ensureAuthed(page: Page) {
  await page.goto('/')
  const email = page.getByRole('textbox', { name: /email/i })

  if (await email.isVisible().catch(() => false)) {
    await email.fill('admin@example.com')
    await page.getByLabel(/password/i).fill('mock')
    await page.getByRole('button', { name: /sign in/i }).click()
  }

  await page.waitForLoadState('networkidle')
}

function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgba?\(([^)]+)\)/)
  if (!match) {
    throw new Error(`[chart-theme-tokens] not an rgb() value: ${rgb}`)
  }
  const [r, g, b] = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

// Reads --chart-1..8 as computed on `selector` by the real cascade: globals.css
// `:root`/`.dark` versus the inline themeStyle() <style> block in <body>.
// Both `:root` and `.dark` are specificity (0,1,0), so only source order
// decides the winner; jsdom cannot resolve that, only a real browser can.
async function readChartVars(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ({ selector: sel, count }) => {
      const el = document.querySelector(sel)
      if (!el) return []
      const cs = getComputedStyle(el)
      return Array.from({ length: count }, (_, i) => cs.getPropertyValue(`--chart-${i + 1}`).trim().toUpperCase())
    },
    { selector, count: LIGHT_COLUMN.length }
  )
}

// Reads the computed fill of every element matching `selector`, deduped and
// converted to hex. This is the part no unit test can see: jsdom does not
// run layout or paint, so it cannot tell what color a Recharts <path>
// actually rendered on screen.
async function readDistinctPaintedFills(page: Page, selector: string): Promise<string[]> {
  const fills = await page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).map((el) => getComputedStyle(el).fill),
    selector
  )
  return Array.from(new Set(fills.map(rgbToHex)))
}

test('light :root chart tokens match the validated light column', async ({ page }) => {
  await ensureAuthed(page)
  const vars = await readChartVars(page, 'html')
  expect(vars).toEqual(LIGHT_COLUMN)
})

// The load-bearing assertion. themeStyle() emits `:root` and `.dark` into one
// inline <style> in <body>; both selectors sit at specificity (0,1,0), so
// only source order decides whether `.dark` beats globals.css. A regression
// that dropped or reordered the `.dark` block would keep every jsdom test
// green, because jsdom does not implement the real CSS cascade.
test('dark .dark chart tokens match the validated dark column, on both dark-mode mechanisms', async ({ page }) => {
  await ensureAuthed(page)

  // /wall is a dark surface: authenticated-layout.tsx adds `.dark` to
  // document.documentElement, and ThemeProvider separately wraps the tree in
  // a nested `[data-theme="dark"].dark` display:contents div. Both are live
  // on this route at once.
  await page.goto('/wall')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('html.dark')).toHaveCount(1)
  const fromDocumentElement = await readChartVars(page, 'html')
  expect(fromDocumentElement).toEqual(DARK_COLUMN)

  await expect(page.locator('[data-theme="dark"].dark')).toHaveCount(1)
  const fromThemeProviderDiv = await readChartVars(page, '[data-theme="dark"].dark')
  expect(fromThemeProviderDiv).toEqual(DARK_COLUMN)
})

test('a painted chart mark reads a light-column color in light mode', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/dashboards/1')

  // "AQI Trend" is an area chart keyed by station (4 distinct series), the
  // multi-series chart on this dashboard whose marks are <path fill> rather
  // than <path stroke> (the line chart above it is stroke-only).
  await expect(page.getByText('AQI Trend')).toBeVisible()

  await expect
    .poll(() => readDistinctPaintedFills(page, '.recharts-area-area'), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(LIGHT_COLUMN.slice(0, 4)))
})

test('a painted chart mark reads a dark-column color in dark mode, not the light one', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/present/1')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('html.dark')).toHaveCount(1)

  // Slide 0 is "Ridership Trend" (a line chart, stroke-only). Advance to
  // slide 3, "Incidents by Day": a stacked bar chart with 4 category series,
  // each a <path fill>. `:not(.recharts-reference-area-rect)` excludes the
  // chart's "today" reference band, which is also a recharts-rectangle but
  // not a palette-driven series mark.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('heading', { name: /incidents by day/i, level: 2 })).toBeVisible()

  const seriesMarks = '.recharts-rectangle:not(.recharts-reference-area-rect)'
  await expect
    .poll(() => readDistinctPaintedFills(page, seriesMarks), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(DARK_COLUMN.slice(0, 4)))

  const fills = await readDistinctPaintedFills(page, seriesMarks)
  const paintedALightOnlyColor = fills.some((fill) => LIGHT_HEXES_DISTINCT_FROM_DARK.includes(fill))
  expect(paintedALightOnlyColor).toBe(false)
})
