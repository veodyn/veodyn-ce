// The theme vocabulary, shared by the two things that decide which tokens are
// live: the <script> in the root layout that runs before React exists, and the
// hook that keeps the class in step once it does. Pure, so it stays testable
// without a DOM and cannot drift between those two consumers.

import { featureList, type FeatureDescriptor } from '@/features'

export type ThemePreference = 'light' | 'dark' | 'system'
/** What a preference actually resolves to. There is no 'system' surface. */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'veodyn.theme'
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

// A reader who has never touched the control follows their OS. That is the
// default the server renders too, so the markup and the first client snapshot
// agree even before localStorage is read.
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

/** Menu order for any control that offers all three. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

// Surfaces whose theme is a property of the surface, not of the reader.
//
// One table, two consumers: forcedTheme() for the mounted app, and the same
// patterns serialised into themeInitScript() below. Written once because the
// two disagreeing is exactly the bug that produces a flash of the wrong theme
// (or, on the print route, a dark page sent to a printer).
//
// /embed/* renders one widget inside somebody else's page. We cannot see the
// host's chrome, so it keeps the light appearance it has always had rather
// than inheriting a preference the host never expressed. This is NOT
// feature-owned: it applies to every embeddable surface CE ships, so it stays
// hardcoded rather than living in a descriptor.
const EMBED_FORCED_THEME: { pattern: RegExp; theme: ResolvedTheme } = {
  pattern: /^\/embed\//,
  theme: 'light',
}

// The report print route (ink on paper) and the wall/present routes
// (presentation surfaces, dark by design) are feature-owned: they come from
// the routes each installed feature's descriptor declares, not from a list
// re-typed here. With no reports or wall package installed, neither rule
// exists and both surfaces fall back to the reader's preference like any
// other route. The registry is an explicit optional parameter, defaulting to
// the real one, so a test can exercise the empty-registry path without
// mocking @/features.
function featureForcedThemeRules(
  registry?: Record<string, FeatureDescriptor>
): Array<{ pattern: RegExp; theme: ResolvedTheme }> {
  return featureList(registry)
    .flatMap((feature) => feature.routes)
    .filter((route) => route.forcedTheme !== undefined)
    .map((route) => ({ pattern: route.pattern, theme: route.forcedTheme as ResolvedTheme }))
}

function forcedThemeRules(
  registry?: Record<string, FeatureDescriptor>
): Array<{ pattern: RegExp; theme: ResolvedTheme }> {
  return [EMBED_FORCED_THEME, ...featureForcedThemeRules(registry)]
}

/** The theme this path insists on, or null to follow the reader's preference. */
export function forcedTheme(pathname: string, registry?: Record<string, FeatureDescriptor>): ResolvedTheme | null {
  for (const rule of forcedThemeRules(registry)) {
    if (rule.pattern.test(pathname)) return rule.theme
  }
  return null
}

/**
 * The blocking script that settles the theme before the first paint.
 *
 * Without it a reader who prefers dark gets a white page for as long as it
 * takes React to hydrate, because the server cannot read localStorage and has
 * no media query to consult. It is emitted as the first child of <body>, so it
 * runs while there is still nothing on screen to flash.
 *
 * Written as a string of ES5 rather than a stringified function: this runs
 * before any bundle, so it gets no transpilation and no polyfills.
 */
export function themeInitScript(registry?: Record<string, FeatureDescriptor>): string {
  const rules = forcedThemeRules(registry)
    .map((rule) => `[${rule.pattern.toString()},${JSON.stringify(rule.theme)}]`)
    .join(',')

  return (
    '(function(){try{' +
    `var f=[${rules}],t=null,i=0;` +
    'for(;i<f.length;i++){if(f[i][0].test(location.pathname)){t=f[i][1];break}}' +
    'if(!t){' +
    // localStorage throws outright in some privacy modes. Swallowing that is
    // the correct behaviour and not a silent error: `s` stays null, the media
    // query below still runs, and the reader gets their system theme instead
    // of losing the preference machinery entirely. Nothing to report and
    // nowhere to report it, since this runs before the app exists.
    `var s=null;try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}` + // silent-ok
    'if(s==="light"||s==="dark"){t=s}' +
    `else if(window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_MEDIA_QUERY)}).matches){t="dark"}` +
    'else{t="light"}' +
    '}' +
    'var e=document.documentElement;' +
    'e.classList.toggle("dark",t==="dark");' +
    'e.setAttribute("data-theme",t);' +
    // The outer catch is the whole point of a pre-paint script: whatever goes
    // wrong in here, the document must still render. Failing open leaves the
    // light tokens in place, which is exactly the pre-feature behaviour.
    '}catch(e){}})()' // silent-ok
  )
}
