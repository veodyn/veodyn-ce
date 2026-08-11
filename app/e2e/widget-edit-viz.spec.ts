import { expect, test } from '@playwright/test'

// Editing a visualization from the dashboard, end to end.
//
// The jsdom test beside the component (visualization-widget.edit.test.tsx)
// proves the write lands in the store. It cannot prove the thing that makes the
// control worth having: that the widget on the page redraws afterwards. A widget
// renders from `widget.visualization`, which belongs to the DASHBOARD payload,
// not to the query the write went to, so a save that invalidated only the query
// left the panel showing its old configuration until a reload. That failure is
// invisible to a unit test of either half.
test('a visualization saved from a widget redraws that widget', async ({ page }) => {
  await page.goto('/dashboards/2')
  await page.waitForLoadState('networkidle')

  // The second widget here is the table one. Its visualization is named "Table",
  // which the header deliberately does not print as a suffix, so the suffix
  // appearing at the end is unambiguous evidence of a re-render from new data
  // rather than of anything the dialog left on screen.
  const pencil = page.getByRole('button', { name: 'Edit visualization' }).nth(1)
  await expect(pencil).toBeVisible()
  await pencil.click()

  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  // Says what is being edited and how far the change reaches, because neither is
  // implied by having clicked a pencil on a dashboard.
  await expect(dialog).toContainText('Every dashboard and report showing this visualization')

  await dialog.getByLabel('Name').fill('Availability grid')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('· Availability grid')).toBeVisible()
})
