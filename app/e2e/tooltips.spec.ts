import { expect, test, type Page } from '@playwright/test'

// Icon-only controls explain themselves through a tooltip, and a unit test
// cannot see whether the bubble actually paints: jsdom has no layout, so a
// popup rendered behind the rail, off screen, or under a stacking context would
// still pass there. These run in a real browser and check what a person sees.

// Mock mode (NEXT_PUBLIC_REDASH_URL unset) normally auto-authenticates the
// mock user. Fall back to the mock login form if it appears.
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

// Scoped to the open popup: a bubble being replaced by its neighbour is still
// in the DOM for the length of its exit animation, so an unscoped selector
// matches two of them mid-sweep.
const tooltip = (page: Page) => page.locator('[data-slot="tooltip-content"][data-open]')

test('the collapsed rail names its icons beside them', async ({ page }) => {
  await ensureAuthed(page)

  const rail = page.locator('aside')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(rail).toHaveClass(/md:w-14/)

  const item = rail.getByRole('link', { name: 'Dashboards' })
  await item.hover()
  await expect(tooltip(page)).toHaveText('Dashboards')

  // Beside the icon, not over it: a label painted on top of the thing it names
  // would be worse than the labels collapsing removed. Polled rather than
  // measured once, because the bubble slides in from the left and its first
  // frames genuinely do overlap.
  const itemBox = await item.boundingBox()
  if (!itemBox) throw new Error('the rail item is not laid out')
  await expect
    .poll(async () => (await tooltip(page).boundingBox())?.x ?? -1)
    .toBeGreaterThanOrEqual(itemBox.x + itemBox.width)
  const tipBox = await tooltip(page).boundingBox()
  expect(tipBox?.width ?? 0).toBeGreaterThan(0)
})

test('an expanded rail stays quiet, where the labels are already on screen', async ({ page }) => {
  await ensureAuthed(page)

  await page.locator('aside').getByRole('link', { name: 'Dashboards' }).hover()
  await expect(tooltip(page)).toHaveCount(0)
})

test('an icon button explains itself and still takes the click', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/queries')
  await page.waitForLoadState('networkidle')

  const star = page.getByRole('button', { name: 'Add to favorites' }).first()
  await star.hover()
  await expect(tooltip(page)).toHaveText('Add to favorites')

  // The bubble must not be sitting between the pointer and the button it
  // describes.
  await star.click()
  await expect(page.getByRole('button', { name: 'Remove from favorites' }).first()).toBeVisible()
})

// The densest icon cluster in the app: refresh, expand, annotate and open, four
// glyphs in a row with nothing else to tell them apart.
test('a widget toolbar names the icon under the pointer', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/dashboards/1')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Expand' }).first().hover()
  await expect(tooltip(page)).toHaveText('Expand')

  // Sweeping to the next icon rather than leaving and coming back: with one
  // provider for the app the second label replaces the first with no fresh
  // delay, and the open bubble must not sit between the pointer and the button
  // it is about to name.
  const annotate = page.getByRole('button', { name: 'Annotate' }).first()
  const box = await annotate.boundingBox()
  if (!box) throw new Error('the annotate control is not laid out')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(tooltip(page)).toHaveText('Annotate')
})

test('a menu trigger keeps its menu after gaining a tooltip', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/queries/1')
  await page.waitForLoadState('networkidle')

  const kebab = page.getByRole('button', { name: 'Query actions' })
  await kebab.hover()
  await expect(tooltip(page)).toHaveText('Query actions')

  await kebab.click()
  await expect(page.getByRole('menuitem', { name: 'Add to Dashboard' })).toBeVisible()
})
