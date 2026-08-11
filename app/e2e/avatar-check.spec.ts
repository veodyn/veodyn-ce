import { test, expect } from '@playwright/test'

// The avatar must be drawn locally, and no avatar may cost a third-party
// request. Redash synthesises a gravatar.com URL for every user who has not
// uploaded an image, so rendering profile_image_url naively ships the user's
// email hash to gravatar.com on every page view. That is disqualifying for a
// product that ships into other people's clusters, and a jsdom suite cannot
// see it: only a real browser reports what was actually requested.
//
// /users (Team) cannot stand in for this: it reads users straight off Redash
// rather than the mock store, so in mock mode it renders "Could not load
// users". The profile page composes the same UserAvatar from the mock identity.
test('the profile draws a local avatar and calls no third party', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname
    if (host !== 'localhost' && host !== '127.0.0.1') external.push(r.url())
  })

  await page.goto('/profile')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'test-results/avatar-profile.png', fullPage: false })

  // The fixture behind this page carries a real gravatar URL, the way Redash
  // returns one for every user without an upload. Without that, this whole
  // assertion was vacuous: an implementation that happily loaded any remote
  // image would still have made no request against an empty string.
  const avatar = page.getByTestId('user-avatar').first()
  await expect(avatar).toHaveText(/^[A-Z]{1,2}$/)

  expect(external).toEqual([])
  expect(await page.getByTestId('user-avatar').count()).toBeGreaterThan(0)
  expect(await page.locator('img[src*="gravatar"]').count()).toBe(0)
})
