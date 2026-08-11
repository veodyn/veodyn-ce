// Single server-side env boundary.
//
// Rules:
//   1. This file is the ONLY place server code reads `process.env`.
//   2. The schema is the source of truth for the `Env` type.
//   3. `parse` throws at import time: fail fast on misconfiguration.
//   4. Add new server vars here with a shape and a sensible default.
//
// SERVER ONLY. Do not import this into a client component or a client bundle:
// it reads server secrets and throws on the server at import. `NEXT_PUBLIC_*`
// vars are inlined by Next at build time, so read those directly at the call
// site instead of routing them through here.
//
// Consumers (server code only):
//   import { env } from '@/lib/env'
//   fetch(env.REDASH_URL, { signal })
//
// Defaults below mirror the current inline `process.env.X || '...'` fallbacks,
// so migrating a read to `env.X` is behavior-preserving. Migrate on-touch, not
// in bulk (see ../../.claude/rules/starter-patterns.md).

import { z } from 'zod'

const envSchema = z.object({
  // ── Redash backend (server-side proxy) ────────────────────────────────────
  REDASH_URL: z.string().default(''),
  REDASH_INTERNAL_API_KEY: z.string().default(''),
  REDASH_API_KEY: z.string().default(''),
  // Client toggle (mock vs real). Also readable server-side. Prefer reading it
  // directly in client code; kept here for server-side checks only.
  NEXT_PUBLIC_REDASH_URL: z.string().optional(),

  // ── Veodyn AI assistant (server-only secret; config.ts carries the rest) ──
  VEODYN_AI__KEY: z.string().default(''),

  // ── Catalog backend (server-side proxy for /api/catalog + /api/domains) ────
  // Unset = the endpoints 503; mock mode never calls them. The backend track
  // points this at the real catalog service to light real data up with no
  // frontend change (MVP spec section 4).
  CATALOG_API_URL: z.string().optional(),

  // ── KPI and Reports backends ───────────────────────────────────────────────
  // Read HERE by /api/favorites (first of the two that is set) and /api/tags
  // (first of all three aliases). Unset = those endpoints 503; mock mode never
  // calls them.
  //
  // They stay declared even though the /api/kpis* and /api/reports* proxy routes
  // themselves are not part of this edition. This schema is CLOSED: `parse`
  // throws at import time, so a variable an overlay build needed and this file
  // did not declare would take the whole app down at boot rather than one
  // endpoint, and the only way to add one would be to patch this file textually.
  // Declaring them costs nothing (two community endpoints want them anyway) and
  // it is what lets an overlay restore those routes by copying files in, with no
  // patch step and no coupling to this file's layout.
  KPI_API_URL: z.string().optional(),
  REPORTS_API_URL: z.string().optional(),

  // ── Telemetry (PostHog) ───────────────────────────────────────────────────
  // POSTHOG_KEY is a project ingestion token that posthog-js ships to every
  // browser and POSTHOG_HOST is a public URL, so neither is a secret and both
  // sit in the Helm values in the clear. Either one empty disables telemetry
  // completely, browser and server, which is how the prod release stays dark.
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
    // STATICALLY. The spread above is one opaque object read, so the transform
    // cannot see through it, and the build-time value never lands in this
    // object. Written explicitly, the same literal the client bundle got is
    // the one the server gets.
    //
    // Without this line the two readers of this flag disagree inside a single
    // process: `services/redash/config.ts` and `middleware.ts` reference it
    // statically and saw "1", while everything reading `env.X` saw undefined.
    // On the dev deployment that put every /api/ai/* route into demo mode, so
    // the surfaces answered with mock fixtures while the rest of the app ran
    // on real data, AND it skipped the Redash session check those routes make
    // before spending the instance's model quota.
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
