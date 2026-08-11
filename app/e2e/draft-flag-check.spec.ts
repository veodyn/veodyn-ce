import { test, expect } from '@playwright/test'

// Throwaway controller check. Run twice by hand:
//   (default)                          -> the "off" test passes
//   VEODYN_FEATURES__QUERY_DRAFTS=true -> the "on" test passes
const DRAFTS_ON = process.env.VEODYN_FEATURES__QUERY_DRAFTS === 'true'

test('the query surface matches the draft workflow flag', async ({ page }) => {
  await page.goto('/queries/1')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.screenshot({ path: `test-results/draft-${DRAFTS_ON ? 'on' : 'off'}.png` })

  await page.getByRole('button', { name: 'Query actions' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await page.screenshot({ path: `test-results/draft-${DRAFTS_ON ? 'on' : 'off'}-menu.png` })

  if (DRAFTS_ON) {
    // One of the two, depending on whether fixture query 1 is already shared.
    const share = await menu.getByText(/share with the team/i).count()
    const unshare = await menu.getByText(/make it a draft/i).count()
    expect(share + unshare).toBe(1)
    expect(await menu.getByText(/publish/i).count()).toBe(0)
  } else {
    expect(await page.getByText('Draft', { exact: true }).count()).toBe(0)
    expect(await menu.getByText(/share with the team/i).count()).toBe(0)
    expect(await menu.getByText(/make it a draft/i).count()).toBe(0)
    expect(await menu.getByText(/publish/i).count()).toBe(0)
  }
})
