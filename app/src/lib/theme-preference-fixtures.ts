// Two synthetic descriptors, shared by the two suites over the theme
// vocabulary: theme-preference.test.ts (forcedTheme) and
// theme-init-script.test.ts (the same table serialised into the pre-paint
// script).
//
// Synthetic rather than whatever this build installs, because what those two
// consumers have to get right is the MECHANISM: a rule a descriptor declares
// beats the reader's preference, a path the pattern excludes does not, and the
// same table reaches both consumers. None of that is a property of which
// surfaces an edition ships, and asserting it through the registry that
// happens to be installed made the cases pass or fail on the build they ran in
// rather than on the code under test. The CONTENT (which routes a shipped
// surface claims, and which theme it insists on) is asserted by the build that
// installs it, in a suite that ships with it.
//
// `alpha` owns one ink-on-paper leaf route, `beta` a whole dark surface, so a
// walk has to reach the second descriptor rather than stopping at the first.
// Both shapes are the ones real descriptors use.
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
