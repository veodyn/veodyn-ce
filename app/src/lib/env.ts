// Single server-side env boundary: the ONLY place server code reads
// `process.env`, and the source of truth for the `Env` type. Parsing throws at
// import time.
//
// SERVER ONLY: never import into a client component or bundle, it reads server
// secrets. Read `NEXT_PUBLIC_*` directly at the call site instead.
//
// Migrate reads to `env.X` on-touch, not in bulk
// (../../.claude/rules/starter-patterns.md).

import { z } from 'zod'

const envSchema = z.object({
  // ── Redash backend (server-side proxy) ────────────────────────────────────
  REDASH_URL: z.string().default(''),
  REDASH_INTERNAL_API_KEY: z.string().default(''),
  REDASH_API_KEY: z.string().default(''),
  // Client toggle (mock vs real). Kept here for server-side checks only; read
  // it directly in client code.
  NEXT_PUBLIC_REDASH_URL: z.string().optional(),

  // ── Veodyn AI assistant (server-only secret; config.ts carries the rest) ──
  VEODYN_AI__KEY: z.string().default(''),

  // ── Catalog backend (server-side proxy for /api/catalog + /api/domains) ────
  // Unset = the endpoints 503; mock mode never calls them (MVP spec section 4).
  CATALOG_API_URL: z.string().optional(),

  // ── KPI and Reports backends ───────────────────────────────────────────────
  // Read HERE by /api/favorites (first of the two that is set) and /api/tags
  // (first of all three aliases). Unset = those endpoints 503.
  //
  // They stay declared though the /api/kpis* and /api/reports* routes are not
  // in this edition: the schema is closed and throws at import, so an overlay
  // build needing an undeclared var would fail at boot.
  KPI_API_URL: z.string().optional(),
  REPORTS_API_URL: z.string().optional(),

  // ── Telemetry (PostHog) ───────────────────────────────────────────────────
  // Neither is a secret: POSTHOG_KEY is a browser-shipped ingestion token and
  // POSTHOG_HOST is a public URL. Either one empty disables telemetry
  // completely, browser and server.
  POSTHOG_KEY: z.string().default(''),
  POSTHOG_HOST: z.string().default(''),
  DISABLE_TELEMETRY: z
    .string()
    .default('')
    .transform((v) => v === 'true' || v === '1'),
  TELEMETRY_CONSOLE_FORWARDING: z
    .string()
    .default('')
    .transform((v) => v === 'true' || v === '1'),
  // Git SHA of the running build, so a regression can be pinned to a deploy.
  APP_COMMIT: z.string().default(''),
  APP_VERSION: z.string().default(''),
}) satisfies z.ZodType

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    ...process.env,
    // Next inlines `process.env.NEXT_PUBLIC_X` only where it is written out
    // STATICALLY, and the spread above is one opaque read. Without this line
    // `env.X` is undefined while the static readers (`services/redash/config.ts`,
    // `middleware.ts`) see the real value.
    NEXT_PUBLIC_REDASH_URL: process.env.NEXT_PUBLIC_REDASH_URL,
  })
  if (!parsed.success) {
    // Surface the exact field and reason at startup, not 10 stack frames deep.
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`[env] invalid configuration:\n${lines.join('\n')}`)
  }
  return parsed.data
}

export const env = loadEnv()
