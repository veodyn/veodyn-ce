import { expect, test } from '@playwright/test'

// The browser half of the ItemsTable header-size guard.
//
// The unit test in src/components/shared/items-table.test.tsx resolves the
// effective font size from the class cascade, because jsdom loads no stylesheet
// and reports the initial keyword 'medium' for every element. That catches the
// defect but proves nothing about what a browser draws. This spec measures the
// real thing.
//
// The defect: the sort control inherited the th's `text-xs` while it was a raw
// <button>; rebuilt on the Button primitive it took Button's own `text-sm`, so
// sortable headers rendered at 14px next to 12px non-sortable ones.
//
// /captures is the route that makes it visible in a single row: Capture,
// Status, Last received and Cadence are sortable, Datasets is not.
test('every column header label is the size its header cell declares', async ({ page }) => {
  await page.goto('/captures')
  await page.waitForLoadState('networkidle')

  const headers = page.locator('thead th')
  await expect(headers.first()).toBeVisible()

  const sizes = await headers.evaluateAll((cells) =>
    cells
      .map((th) => {
        const label = th.querySelector('button, span')
        return label
          ? {
              text: (th.textContent ?? '').trim(),
              tag: label.tagName,
              cell: getComputedStyle(th).fontSize,
              label: getComputedStyle(label).fontSize,
            }
          : null
      })
      .filter((entry) => entry !== null)
  )

  // Both kinds of header have to be present or this guard proves nothing.
  expect(sizes.some((s) => s.tag === 'BUTTON')).toBe(true)
  expect(sizes.some((s) => s.tag === 'SPAN')).toBe(true)

  for (const size of sizes) {
    expect(size.label, `header "${size.text}" (${size.tag})`).toBe(size.cell)
  }
  expect(new Set(sizes.map((s) => s.label)).size).toBe(1)
})
