// Where an instance's visualization plugins are installed. The stock build
// installs none; see docs/visualization-plugins.md.
//
// Imported for its side effect from the entry of each module graph that needs a
// populated registry, because registration is per graph:
//
//   src/app/providers.tsx              the browser
//   src/lib/public-report-options.ts   server-side callers, which reach the
//                                      registry through sanitizeVizOptions
//
// It cannot be imported from `@/lib/visualizations` instead: a plugin imports
// that barrel, so the barrel importing this file is a cycle, and under it a
// plugin reads PLUGIN_API_VERSION as `undefined` while the barrel is still
// initialising.

/**
 * Every plugin package in this repo, by the name an image installs it under.
 *
 * Generated from the package directories under src/plugins/ by
 * scripts/generate-plugin-registry.mjs; run `pnpm gen:plugins` after adding or
 * removing a package. Re-exported here so installing one never touches this file.
 */
export { PLUGIN_PACKAGES } from './generated-registry'
import { PLUGIN_PACKAGES } from './generated-registry'

/**
 * Which packages this image installs, from `NEXT_PUBLIC_VEODYN_PLUGINS`
 * (comma-separated, e.g. `example`).
 *
 * Read directly rather than through `@/lib/env`: NEXT_PUBLIC_* is inlined at
 * build time and the env boundary is server-only, while the registry is
 * populated in the browser too. See app/CLAUDE.md.
 */
export function installedPluginNames(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

/**
 * Register the named packages.
 *
 * An unknown name warns and is skipped rather than throwing, since that failure
 * is a stale env var against a newer image and refusing to boot over one takes
 * the whole app down. Registering twice does throw, from the registry.
 */
export function registerInstalledPlugins(names: readonly string[]): void {
  for (const name of names) {
    const register = PLUGIN_PACKAGES[name]
    if (!register) {
      console.warn(
        `[plugins] NEXT_PUBLIC_VEODYN_PLUGINS names "${name}", which this build does not ` +
          `contain. Known packages: ${Object.keys(PLUGIN_PACKAGES).join(', ')}. Ignoring it.`
      )
      continue
    }
    register()
  }
}

registerInstalledPlugins(installedPluginNames(process.env.NEXT_PUBLIC_VEODYN_PLUGINS))
