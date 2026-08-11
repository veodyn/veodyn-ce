import { expect, test, type Page } from '@playwright/test'

// axis-config.ts's Y_AXIS_HEADROOM, as the share of the plot's height the
// highest mark should reach: a domain stretched 20% past what the data needs
// leaves the peak at 1/1.2 of the way up. Copied rather than imported, same
// reasoning as e2e/chart-theme-tokens.spec.ts: this spec checks where recharts
// actually drew the mark, not what the source module says it should compute.
const PEAK_HEIGHT = 1 / 1.2

// A couple of pixels on a plot a couple of hundred pixels tall, in fractional
// terms. A path's bounding box includes its stroke, so the top of a line sits
// half a stroke-width above the point it draws.
const TOLERANCE = 0.02

// Mirrors the helper in e2e/baseline.spec.ts and
// e2e/chart-theme-tokens.spec.ts.
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

// How far up the plot the highest mark reaches, as a share of the plot's
// height, in the first chart on the page that draws `markSelector`. The grid
// spans exactly the plot area, so its box is the frame the mark is measured
// against, and every mark in that one chart is considered because a stacked
// series draws its layers bottom-first: the highest pixel is not the first
// path. This is the number no unit test can reach, since it depends on recharts
// honouring the domain it was handed instead of re-rounding it onto its own
// tick grid.
async function peakHeight(page: Page, markSelector: string): Promise<number> {
  const chart = page.locator('.recharts-wrapper', { has: page.locator(markSelector) }).first()
  const grid = await chart.locator('.recharts-cartesian-grid').first().boundingBox()
  const marks = await chart.locator(markSelector).all()
  const boxes = (await Promise.all(marks.map((mark) => mark.boundingBox()))).filter((box) => box != null)

  if (!grid || boxes.length === 0) {
    throw new Error(`[chart-headroom] no box for ${!grid ? '.recharts-cartesian-grid' : markSelector}`)
  }

  const highest = Math.min(...boxes.map((box) => box.y))
  return (grid.y + grid.height - highest) / grid.height
}

test('a line chart leaves a fifth of the plot free above its highest point', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/dashboards/1')
  await expect(page.locator('.recharts-line-curve').first()).toBeVisible()

  const height = await peakHeight(page, '.recharts-line-curve')
  expect(Math.abs(height - PEAK_HEIGHT)).toBeLessThan(TOLERANCE)
})

test('an area chart leaves the same share free, so the two read on the same footing', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/dashboards/1')
  await expect(page.locator('.recharts-area-area').first()).toBeVisible()

  const height = await peakHeight(page, '.recharts-area-area')
  expect(Math.abs(height - PEAK_HEIGHT)).toBeLessThan(TOLERANCE)
})
