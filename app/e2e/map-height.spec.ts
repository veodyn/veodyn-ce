import { expect, test, type Page } from '@playwright/test'

// Every map on stage rendered as a blank panel, and the whole unit suite stayed
// green through it: jsdom has no layout engine, so nothing there can tell a
// 400px map from a 0px one. This spec exists to be the test that can fail.
//
// The defect: the wrapper carried `h-full min-h-[400px]` and the map inside it
// carried `height: 100%`. min-h fixes the wrapper's USED height at 400px while
// its COMPUTED height stays auto, and a percentage resolves against the
// computed value, so the map collapsed to zero inside a wrapper that measured
// a healthy 400px. Asserting on the wrapper alone would therefore have passed
// against the bug. The assertions below are on the map element itself.

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

// Query 3 in the neutral mock pack carries visualization 16, a MAP named
// "Station Map" (src/lib/mock-data/packs/neutral/queries-set-a.ts).
test('a marker map fills its panel instead of collapsing', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/queries/3')

  await page.getByRole('tab', { name: 'Station Map' }).click()

  const map = page.locator('.maplibregl-map')
  await expect(map).toBeVisible()

  const box = await map.boundingBox()
  if (!box) throw new Error('[map-height] the map element has no box')

  // The exact number is the wrapper's min-h-[400px] floor. Asserting "> 0"
  // would pass on a 1px sliver, which is just as blank to a reader.
  expect(box.height).toBeGreaterThanOrEqual(300)

  // The canvas is the part that actually paints. MapLibre gives a fresh canvas
  // a 300px default height and never resizes it when the container is zero, so
  // a canvas that matches its container is the evidence that sizing reached
  // the renderer rather than the container happening to look right.
  const canvasBox = await map.locator('canvas').first().boundingBox()
  if (!canvasBox) throw new Error('[map-height] the map has no canvas')
  expect(Math.abs(canvasBox.height - box.height)).toBeLessThanOrEqual(2)
})
