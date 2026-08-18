import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installsNoFeaturePackages } from '@/features'
import { registeredVisualizations } from '@/lib/visualizations'
import { PLUGIN_PACKAGES, installedPluginNames, registerInstalledPlugins } from './index'

describe('installedPluginNames', () => {
  it('reads a comma-separated list, tolerating spacing', () => {
    expect(installedPluginNames('example')).toEqual(['example'])
    expect(installedPluginNames(' example , other ')).toEqual(['example', 'other'])
  })

  // An unset var is the stock build, an empty string is a cleared one. Both mean
  // "no plugins", and a naive split turns the empty string into a package named "".
  it('installs nothing when the variable is unset or empty', () => {
    expect(installedPluginNames(undefined)).toEqual([])
    expect(installedPluginNames('')).toEqual([])
    expect(installedPluginNames(' , ')).toEqual([])
  })
})

describe('registerInstalledPlugins', () => {
  afterEach(() => vi.restoreAllMocks())

  // The stock OSS build: importing this module must not put a tenant's
  // visualizations into the registry.
  it('registers nothing on import, since the test env names no packages', () => {
    expect(registeredVisualizations().every((entry) => entry.origin === 'core')).toBe(true)
  })

  // A stale env var should degrade the UI, not stop the container. This is the
  // same call the module makes at import, so a throw here is a boot failure.
  it('warns about an unknown package and carries on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => registerInstalledPlugins(['not-a-package'])).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('not-a-package')
    expect(registeredVisualizations().every((entry) => entry.origin === 'core')).toBe(true)
  })

  it('registers a package it does contain', () => {
    registerInstalledPlugins(['example'])
    const plugins = registeredVisualizations().filter((entry) => entry.origin === 'plugin')
    expect(plugins.map((entry) => entry.plugin.type)).toContain('EXAMPLE_HELLO_PANEL')
  })

  // Registering the same package twice is a wiring bug (two entry points both
  // registering), and the registry's duplicate-type throw is what surfaces it.
  it('throws rather than silently re-registering', () => {
    expect(() => registerInstalledPlugins(['example'])).toThrow(/already registered/)
  })

  // The map is what the bundler sees, so a package missing from it cannot be
  // installed however the env var is spelled. Not an exact list: a pack overlay
  // build adds its own package directories on top of this one.
  it('names the example package, which the public build always carries', () => {
    expect(Object.keys(PLUGIN_PACKAGES)).toContain('example')
  })
})

// An invariant OF THE COMMUNITY REPOSITORY, and the only guard between customer
// plugin code and a public commit. It reads git, so it is a statement about what
// this checkout tracks and not about what any build renders.
//
// Skipped where feature packages are installed: a composed tree is assembled
// INSIDE the community checkout (build-overlay.sh refuses anywhere else), so its
// `git ls-files` is the host repository's and answers for a tree the composed run
// did not assemble.
describe.skipIf(!installsNoFeaturePackages())('tracked plugin packages', () => {
  // Reads `git ls-files` rather than the filesystem: an overlay copies a package
  // directory onto disk but never commits it, while customer code re-entering the
  // repo would be tracked. Do not "simplify" this into a readdir, which cannot
  // tell the two apart. The `toContain('example')` case above cannot stand in
  // either: nothing else here compares against anything but the filesystem.
  it('tracks only the public plugin packages in git, regardless of what an overlay adds to disk', (ctx) => {
    // A tree with no .git gives this guard nothing to read, so skip rather than
    // fail. This covers a source copy taken without .git (an image build context);
    // the composed overlay is handled by the registry guard on the describe above.
    //
    // Narrow: only "not a work tree" skips. Any other git failure still fails, so
    // the guard cannot go quiet in CI, where a missing git binary is a real
    // problem.
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    } catch {
      ctx.skip(
        'not a git work tree (an assembled overlay tree); this guard only applies to the repo itself'
      )
      return
    }

    const tracked = execFileSync('git', ['ls-files', 'src/plugins'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    const trackedPackageDirs = new Set(
      tracked
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split('/'))
        // src/plugins/<package>/<file...>; a top-level file directly under
        // src/plugins/ (index.ts, generated-registry.ts, this file) has only
        // 3 segments and names no package.
        .filter((parts) => parts.length > 3)
        .map((parts) => parts[2])
    )
    expect([...trackedPackageDirs].sort()).toEqual(['example'])
  })
})
