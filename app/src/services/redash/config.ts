// Single source of truth for the mock-vs-real toggle.
// When NEXT_PUBLIC_REDASH_URL is set the client talks to the real Redash
// backend through the same-origin /api/node/* proxy; when unset, all entity
// hooks resolve against the in-memory mock store (no backend needed).
export const USE_REAL_API = !!process.env.NEXT_PUBLIC_REDASH_URL
