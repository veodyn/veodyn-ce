/**
 * Deprecated alias for the Redash proxy, kept at its old path.
 *
 * The proxy itself moved to `/api/node/*` (`../../node/[...path]/route.ts`)
 * when the repo's top-level `redash/` directory was renamed to `node/`. This
 * file re-exports the same handlers unchanged so a browser tab holding a
 * cached bundle that still requests `/api/redash/*` keeps working instead of
 * 404ing against pods that no longer serve the old path.
 *
 * Delete this file once a release has shipped past 2026-08-06 confirming no
 * client still calls `/api/redash/*` (check access logs / metrics for the
 * path before removing). `app/src/services/api-client.ts` and every other
 * real caller already point at `/api/node/*`; this alias exists only for
 * traffic this repo does not control (open tabs at rename time).
 */
export { GET, POST, PUT, DELETE, PATCH } from '../../node/[...path]/route'

// Declared literally rather than re-exported alongside the handlers. Next
// parses route segment config statically at build time and refuses a
// re-exported `dynamic`, so `export { dynamic } from ...` fails the build with
// "can't recognize the exported `dynamic` field in route". It must stay equal
// to the canonical route's value in ../../node/[...path]/route.ts, which
// route.alias.test.ts asserts so the two cannot drift.
export const dynamic = 'force-dynamic'
