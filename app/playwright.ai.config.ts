import { defineConfig, devices } from '@playwright/test'

// The AI-enabled posture of every AI spec: the Create-with-AI chat on the
// library pages (ai-create-chat.spec.ts), the editor and Visual builder
// (ai-editor.spec.ts), the report flow (ai-report-flow.spec.ts), and the
// visualization picker's selected state (ai-viz-picker.spec.ts).
//
// ai.enabled is server-side instance config read once at server start, so the
// enabled path needs its own web server. Next refuses to run two dev servers
// from one directory, so this config cannot run at the same time as
// playwright.config.ts: run `pnpm test:e2e` and `pnpm test:e2e:ai` in sequence.
//
// Only the AI specs run here. Everything else the suite covers is posture
// independent and belongs to the default run. Each AI spec carries both
// postures and skips the one this server is not, so a new AI spec has to be
// listed here or its enabled half never runs.
export default defineConfig({
  testDir: './e2e',
  testMatch: /ai-(create-chat|editor|report-flow|viz-picker)\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3101',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // Same mock-mode boot as playwright.config.ts (NEXT_PUBLIC_REDASH_URL
    // unset), on its own port, with the AI gate opened through the documented
    // VEODYN_* instance config overrides. The endpoint is never contacted: in
    // mock mode /api/ai/* answers from src/lib/ai-mock.ts, and ai.endpoint is
    // only required because the schema refuses ai.enabled without one.
    command: 'pnpm exec next dev --port 3101',
    url: 'http://localhost:3101',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_REDASH_URL: '',
      VEODYN_AI__ENABLED: 'true',
      VEODYN_AI__ENDPOINT: 'https://ai.example.invalid',
    },
  },
})
