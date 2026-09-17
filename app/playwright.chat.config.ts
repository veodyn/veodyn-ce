import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /chat-.*\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3102',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm exec next dev --port 3102',
    url: 'http://localhost:3102',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_REDASH_URL: '',
      VEODYN_AI__ENABLED: 'true',
      VEODYN_AI__ENDPOINT: 'https://ai.example.invalid',
      VEODYN_AI__CHAT: 'true',
    },
  },
})
