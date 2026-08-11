import { defineConfig, devices } from '@playwright/test'

// The harness that regenerates every image in docs/static/img/screenshots/.
//
// This is NOT part of `pnpm test:e2e`. It asserts almost nothing and writes 49
// binary files into the docs tree, so it is a generator that happens to be
// written as a Playwright run, and it lives in its own testDir so the default
// config (testDir: './e2e') cannot collect it by accident.
//
// Three deliberate differences from playwright.config.ts:
//
// 1. **A production build, not `next dev`.** The default config runs
//    `next dev` because a test only cares about behaviour. A published
//    screenshot is a picture of the product, and dev mode is not the product:
//    it paints the dev-tools overlay button over the sidebar in every
//    full-page capture (e2e/baseline.spec.ts documents living with exactly
//    that artifact), and it renders with unminified, hot-reload-instrumented
//    output. So this config builds and serves.
//
// 2. **AI on.** Four of the documented surfaces (the Create-with-AI chat, the
//    editor's prompt bar, the Visual builder, and the authoring mode tabs) do
//    not exist when ai.enabled is false, and docs/docs/features/ai.md and
//    features/queries.md document all of them. Same mock-mode recipe as
//    playwright.ai.config.ts: /api/ai/* is answered by src/lib/ai-mock.ts and
//    the endpoint is never contacted, it is only required because the schema
//    refuses ai.enabled without one.
//
// 3. **An instance config is mounted** (e2e-docs/docs-capture.config.yaml),
//    plus the example plugin package. Three documented surfaces render nothing
//    at all on a bare instance: /data/<domain> answers "Domain not found"
//    unless the domain is in the config registry, wall mode has no dashboard to
//    cycle, and Admin -> Plugins has no package to inventory. The config sets
//    no brand or theme, so the captures stay stock Veodyn.
//
// The pack is the neutral one and is not selected here: NEXT_PUBLIC_REDASH_URL
// empty with NEXT_PUBLIC_DEMO_PACK unset resolves to
// src/lib/mock-data/packs/neutral in next.config.ts's activePack(). The empty
// value has to win over .env.local, where a developer working against a real
// backend has that variable set, so the spec asserts a neutral fixture is on
// screen before it writes anything. See e2e-docs/docs-screenshots.spec.ts.
const PORT = process.env.PLAYWRIGHT_SCREENSHOT_PORT || '3102'
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e-docs',
  fullyParallel: false,
  retries: 0,
  // One capture per test, and every capture navigates a route the production
  // server may be answering for the first time.
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    // Matches the 49 images already in the docs tree, all of which are
    // 1600x1000 viewport captures rather than full-page ones. Keeping the
    // geometry identical means a recaptured image drops into the same page
    // layout without reflowing it.
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  },
  webServer: {
    // `pnpm build`, not `pnpm exec next build`: the generated plugin and
    // feature registries are produced by the `prebuild` lifecycle hook, and
    // `pnpm exec` runs the binary directly without it. Building that way
    // captures screenshots of whatever registry happened to be checked in,
    // which is the wrong thing to photograph and would not say so.
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    // A cold production build of this app is the long pole, not the boot.
    timeout: 900_000,
    env: {
      NEXT_PUBLIC_REDASH_URL: '',
      NEXT_PUBLIC_VEODYN_PLUGINS: 'example',
      VEODYN_CONFIG_PATH: 'e2e-docs/docs-capture.config.yaml',
      VEODYN_AI__ENABLED: 'true',
      VEODYN_AI__ENDPOINT: 'https://ai.example.invalid',
    },
  },
})
