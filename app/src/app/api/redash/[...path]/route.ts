/**
 * Deprecated alias for the Redash proxy, which lives at
 * `../../node/[...path]/route.ts`. It exists only for browser tabs holding a
 * cached bundle that still requests `/api/redash/*`; every real caller already
 * points at `/api/node/*`.
 *
 * Delete once access logs show no traffic on the path after 2026-08-06.
 */
export { GET, POST, PUT, DELETE, PATCH } from '../../node/[...path]/route'

// Declared literally: Next parses route segment config statically and fails the
// build on a re-exported `dynamic`. It must stay equal to the canonical route's
// value in ../../node/[...path]/route.ts, which route.alias.test.ts asserts.
export const dynamic = 'force-dynamic'
