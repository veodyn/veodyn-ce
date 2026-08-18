// Two synthetic descriptors shared by theme-preference.test.ts and
// theme-init-script.test.ts. Synthetic rather than the installed registry, so
// the cases assert the mechanism and not which surfaces this build ships.
//
// `alpha` owns one leaf route, `beta` a whole surface, so a walk has to reach
// the second descriptor rather than stopping at the first.
import type { FeatureDescriptor } from '@/features'

export const STUB_REGISTRY: Record<string, FeatureDescriptor> = {
  alpha: {
    id: 'alpha',
    nav: [],
    routes: [{ pattern: /^\/alpha\/[^/]+\/paper\/?$/, forcedTheme: 'light' }],
  },
  beta: {
    id: 'beta',
    nav: [],
    routes: [{ pattern: /^\/beta(\/|$)/, bareChrome: true, forcedTheme: 'dark' }],
  },
}
