import { expect, test } from '@playwright/test'

// The visualization dialog used to change size when you changed Chart Type.
// Each type renders a different set of editors, so with the options column free
// to grow, the column's content set the dialog's height. Measured at a 891px
// viewport: Pie gave 679 and every other type 750, because the pie editor drops
// the two axis boxes and the column falls below the height the rest reach.
//
// Layout is the thing under test, so this is an e2e test rather than a unit
// one: jsdom has no layout and would report 0 for every height here.
test('the visualization dialog holds its size across chart types', async ({ page }) => {
  // A short viewport on purpose. The bug hides on a tall one, where 70vh is
  // large enough that every type reaches the cap and the heights agree anyway.
  await page.setViewportSize({ width: 1293, height: 891 })
  await page.goto('/queries/1')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Add visualization' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()

  // Visualization type -> Chart, so the ChartEditor and its Chart Type select render.
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Chart', exact: true }).click()

  const chartType = dialog.getByRole('combobox').nth(1)
  const heights: number[] = []
  for (const type of ['Line', 'Bar', 'Pie', 'Scatter', 'Area']) {
    await chartType.click()
    await page.getByRole('option', { name: type, exact: true }).click()
    // The preview re-renders on type change; settle before measuring.
    await expect(chartType).toContainText(type, { ignoreCase: true })
    const box = await dialog.boundingBox()
    // The dialog was awaited above so it always has a box; falling back to 0
    // keeps the assertion honest without a non-null assertion.
    heights.push(Math.round(box?.height ?? 0))
  }

  expect(new Set(heights).size, `dialog resized across chart types: ${heights.join(', ')}`).toBe(1)
})
