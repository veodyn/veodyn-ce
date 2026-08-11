import { expect, test, type Page } from '@playwright/test'
import { SKIP_UNLESS_AI, aiEnabledOnServer } from './ai-posture'

// The AI authoring surfaces are gated on server-side config (ai.enabled), which
// a running server cannot change per test, and Next refuses to run a second dev
// server from the same directory. So the posture is a property of the web
// server the run booted, and this file covers both of them:
//
//   pnpm test:e2e                 -> neutral config, ai.enabled false. The
//                                    disabled test runs, the enabled one skips.
//   pnpm test:e2e:ai              -> playwright.ai.config.ts boots the same app
//                                    with VEODYN_AI__ENABLED=true. The enabled
//                                    test runs, the disabled one skips.
//
// Which one is live is read from the app itself rather than from env: the route
// answers 403 when AI is off, and 401 (no session) to this unauthenticated probe
// when it is on. That probe is also the assertion that BOTH server-side gates
// are real: the disabled gate, and the caller-auth gate that refuses to spend
// the instance AI key for an anonymous request before it ever runs.
//
// The editor is Monaco, which @monaco-editor/react loads from a CDN, so these
// two tests need network access the way a developer's browser has it.

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

// A route the dev server has not compiled yet, plus Monaco's own first paint,
// take well over the default 5s expect timeout.
const SURFACE_TIMEOUT = 60_000


const MANUAL_SQL = '-- manual smoke, no AI in the loop'

// Both tests drive a cold dev server through routes it compiles on first hit,
// and the enabled one walks the whole authoring flow, so the default 30s
// per-test budget is not enough for the first run of the day.
test.describe.configure({ timeout: 120_000 })

test('AI disabled: no AI affordance anywhere and the manual SQL path is whole', async ({
  page,
  request,
}) => {
  test.skip(
    await aiEnabledOnServer(request),
    'this server has ai.enabled true, so the disabled posture is covered by the plain pnpm test:e2e run'
  )

  const pageErrors: Error[] = []
  const aiRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/ai/')) aiRequests.push(req.url())
  })

  await ensureAuthed(page)
  await page.goto('/queries/new')

  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: SURFACE_TIMEOUT })

  // Nothing from the AI half of the editor is in the tree. Not disabled, absent.
  await expect(page.getByRole('tablist', { name: 'Authoring mode' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Visual' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'SQL Editor' })).toHaveCount(0)
  await expect(page.getByLabel('Generate SQL with AI')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /generate draft/i })).toHaveCount(0)
  await expect(page.getByText('Visual builder', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Visualization' })).toHaveCount(0)

  // ...and the manual path is the whole product: type SQL, run it, read rows.
  // insertText lands the whole string in one input event: typing it key by key
  // races Monaco's autocomplete, which reorders the characters. A line comment
  // is SQL the editor accepts without popping a completion list over it.
  await editor.click()
  await page.keyboard.insertText(MANUAL_SQL)
  await expect(editor).toContainText(MANUAL_SQL)

  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Query executed successfully (mock)')).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })

  // The page never reached for a model, not even to ask whether it could.
  expect(aiRequests).toEqual([])
  expect(pageErrors.map((error) => error.message)).toEqual([])
})

test('AI enabled: the prompt bar drafts SQL and the Visual builder compiles then locks to PRO', async ({
  page,
  request,
}) => {
  test.skip(
    !(await aiEnabledOnServer(request)),
    SKIP_UNLESS_AI
  )

  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await ensureAuthed(page)
  await page.goto('/queries/new')

  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: SURFACE_TIMEOUT })

  // The prompt bar grounds on the data source schema, so the draft it gets back
  // names a real table from that schema and lands in the editor, never hidden.
  await page.getByLabel('Generate SQL with AI').fill('busiest vehicles by day');
  await page.getByRole('button', { name: 'Generate draft' }).click()

  await expect(page.getByText(/grounded in vehicle_locations/)).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })
  await expect(editor).toContainText('vehicle_locations')

  // A draft is a draft: it is never executed on the analyst's behalf.
  await expect(page.getByText('Query executed successfully (mock)')).toHaveCount(0)

  // The bar becomes an iteration control once there is a draft to iterate on.
  const iterate = page.getByLabel('Edit with prompt')
  await expect(iterate).toBeVisible()
  await iterate.fill('only the last seven days')
  await page.getByRole('button', { name: 'Update draft' }).click()
  await expect(page.getByText(/grounded in vehicle_locations/)).toBeVisible()

  // ── The Visual builder: deterministic, no model in the loop ───────────────
  const authoring = page.getByRole('tablist', { name: 'Authoring mode' })
  await authoring.getByRole('tab', { name: 'Visual' }).click()

  await expect(page.getByText('Visual builder', { exact: true })).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })
  await expect(page.getByRole('heading', { name: 'Dimensions' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Dataset' })).toBeVisible()

  await expect(page.getByRole('region', { name: 'Data' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Visualization' })).toBeVisible()

  await page.getByRole('button', { name: 'line', exact: true }).click()
  await page.getByRole('button', { name: 'Add measure' }).click()

  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Query executed successfully (mock)')).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })

  // ── The visualization picker is not decoration ────────────────────────────
  // What it names is what the run lands in. The builder passed the picked type
  // to its Run callback and the pane's signature dropped it, silently, so this
  // control set a value nothing read. Table is still the default, which is why
  // the assertion above is a table. Bar is one of the five chart shapes the
  // picker breaks out, so this also proves the shape survives the trip.
  await page.getByRole('radio', { name: 'Bar', exact: true }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()

  const chartTab = page.getByRole('tab', { name: 'Bar', exact: true })
  await expect(chartTab).toBeVisible({ timeout: SURFACE_TIMEOUT })
  await expect(chartTab).toHaveAttribute('aria-selected', 'true')
  // The renderer mounted rather than falling into the error boundary. Note the
  // mock backend answers an ad hoc run with one string column, so this proves
  // the wiring and the mount, not that a chart of real data draws a series.
  await expect(page.getByText(/Failed to render visualization/i)).toHaveCount(0)

  // ── Leaving for PRO carries the SQL over, and nothing closes behind it ────
  await page.getByRole('button', { name: 'Open in SQL Editor', exact: true }).click()

  await expect(editor).toBeVisible({ timeout: SURFACE_TIMEOUT })
  await expect(editor).toContainText('rail_network_daily_ridership')
  // The field picks composed this, which is the assertion the SQL preview used
  // to carry before the builder stopped showing a read-only copy of its query.
  await expect(editor).toContainText('sum(vehicle_count)')
  await expect(editor).toContainText('GROUP BY line')
  await expect(page.getByText(/Locked to PRO/)).toHaveCount(0)

  // Back to Visual, with the picks still made. This used to be a dead tab.
  const visualTab = authoring.getByRole('tab', { name: 'Visual' })
  await expect(visualTab).toBeEnabled()
  await visualTab.click()

  await expect(page.getByText('Visual builder', { exact: true })).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })
  await expect(page.getByRole('button', { name: 'line', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  // The picked shape survived the round trip along with the field picks.
  await expect(page.getByRole('radio', { name: 'Bar', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect(editor).toHaveCount(0)

  expect(pageErrors.map((error) => error.message)).toEqual([])
})
