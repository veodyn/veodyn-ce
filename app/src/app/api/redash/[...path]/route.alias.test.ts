import { describe, expect, it } from 'vitest'

import * as alias from './route'
import * as canonical from '../../node/[...path]/route'

// This route only exists to keep an old cached browser bundle from 404ing
// against `/api/redash/*` after the proxy moved to `/api/node/*`. The
// assertion that matters is that it is a re-export, not a fork: if someone
// "fixes" this file by pasting the handler body in instead of re-exporting,
// the two paths silently diverge and only one of them gets bugfixes.
//
// The method set is derived from the canonical route's own exports rather
// than hard-coded here: a hard-coded list (GET/POST/PUT/DELETE/PATCH) stays
// green forever even after node/[...path]/route.ts gains a new method (HEAD,
// OPTIONS, ...), because nothing forces this file to notice. A cached client
// still on `/api/redash/*` would then fall through to Next's own automatic
// handling for the missing method instead of the canonical behaviour. Every
// uppercase, function-valued export other than `dynamic` (route segment
// config, not a handler) is treated as an HTTP method handler.
const HTTP_METHOD_NAME = /^[A-Z]+$/

function methodHandlerNames(moduleExports: Record<string, unknown>) {
  return Object.keys(moduleExports).filter(
    (key) => key !== 'dynamic' && HTTP_METHOD_NAME.test(key) && typeof moduleExports[key] === 'function',
  )
}

describe('the /api/redash alias', () => {
  it('re-exports every HTTP method handler the canonical /api/node route exports', () => {
    const canonicalMethods = methodHandlerNames(canonical as unknown as Record<string, unknown>)
    const aliasExports = alias as unknown as Record<string, unknown>

    // Guards the test itself: if introspection ever finds zero methods on
    // the canonical route (a broken import, or every handler renamed to
    // something this regex cannot see), every assertion below would pass
    // vacuously instead of catching anything.
    expect(canonicalMethods.length).toBeGreaterThan(0)

    for (const methodName of canonicalMethods) {
      expect(aliasExports[methodName]).toBe((canonical as unknown as Record<string, unknown>)[methodName])
    }
  })

  it('does not export a handler the canonical route no longer has', () => {
    // Catches the reverse drift: a method removed from the canonical route
    // that the alias still re-exports under a stale local definition.
    const aliasMethods = methodHandlerNames(alias as unknown as Record<string, unknown>)
    const canonicalExports = canonical as unknown as Record<string, unknown>

    for (const methodName of aliasMethods) {
      expect(canonicalExports).toHaveProperty(methodName)
    }
  })

  it('keeps `dynamic` equal to the canonical route, declared as a literal', () => {
    // `dynamic` is route segment config, which Next.js parses statically at
    // build time: `export { dynamic } from ...` fails the build ("can't
    // recognize the exported `dynamic` field in route"), so route.ts must
    // keep it as a literal. This is the assertion that stops the two values
    // drifting apart silently.
    expect(alias.dynamic).toBe(canonical.dynamic)
  })
})
