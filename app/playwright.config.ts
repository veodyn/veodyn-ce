import { defineConfig, devices } from '@playwright/test'

// Default 3100, overridable because reuseExistingServer is false: if something
// else already holds the port, the run does not quietly screenshot that app, it
// fails to start. PLAYWRIGHT_PORT is the way out when a developer's other
// project is sitting on 3100.
const PORT = process.env.PLAYWRIGHT_PORT || '3100'
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  snapshotDir: './e2e/__screenshots__',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    // Pinned explicitly, after inheriting it silently hid a real defect. A
    // dialog sized `h-[85vh]` puts every absolute floor inside it on a
    // viewport-dependent footing, and a vestigial `min-h-[500px]` cleared its
    // space by 19px at exactly this height while overflowing at every height
    // below. The spec written to catch that could not fail at the one
    // configuration it ran. Declaring the number here makes the dependency
    // visible; specs that care about height sweep a range of their own.
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    // Boot veodyn-de on its own port in mock mode (NEXT_PUBLIC_REDASH_URL
    // unset). Port 3100 avoids colliding with other Next apps a developer
    // may already run on :3000, and reuseExistingServer:false guarantees we
    // screenshot THIS app, never a foreign server that happens to be up.
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    // VEODYN_AI__ENABLED is pinned off, not merely left unset. This run IS the
    // AI-disabled posture that every AI spec skips its other half for
    // (e2e/ai-posture.ts), and `next dev` reads .env.local, where a developer
    // working on an AI surface has every reason to have turned the gate on.
    // Without this line their local run boots enabled, every disabled half
    // skips itself, and the command reports a pass having tested none of them.
    // process.env wins over .env.local in Next, so this is the deciding value.
    env: { NEXT_PUBLIC_REDASH_URL: '', VEODYN_AI__ENABLED: 'false' },
  },
})
