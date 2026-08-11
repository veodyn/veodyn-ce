import { describe, expect, it } from 'vitest'
import { mockDashboards as neutralDashboards } from './packs/neutral'
import { mockDashboards } from './index'

// packs/active.ts, which ./index re-exports from, no longer has an env-var
// branch to exercise here: NEXT_PUBLIC_DEMO_PACK=la only resolves inside a
// tenant overlay build (next.config.ts's turbopack.resolveAlias, once the
// overlay has copied packs/la back onto disk). tsc and Vitest read no Next
// config and packs/la does not exist in this checkout, so active.ts always
// resolves to neutral regardless of NEXT_PUBLIC_DEMO_PACK. This just pins
// that.
describe('mock-data pack selector', () => {
  it('resolves to the neutral pack', () => {
    expect(mockDashboards).toEqual(neutralDashboards)
  })
})
