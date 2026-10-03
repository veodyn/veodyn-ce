import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.VIZ_HOST_PORT || '3320'
const BASE_URL = `http://localhost:${PORT}`
const FIXTURE = 'packages/viz/fixtures/host'

export default defineConfig({
  testDir: './e2e-viz-host',
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  use: { baseURL: BASE_URL, ...devices['Desktop Chrome'] },
  webServer: {
    command: `pnpm build:viz && node ${FIXTURE}/link-package.mjs && pnpm exec next build --webpack ${FIXTURE} && pnpm exec next start ${FIXTURE} --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 600_000,
  },
})
