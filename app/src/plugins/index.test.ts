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

  // An unset env var is the stock build, and an empty string is what an
  // operator leaves behind after clearing one. Both mean "no plugins", and a
  // naive split would turn the empty string into a package named "".
  it('installs nothing when the variable is unset or empty', () => {
    expect(installedPluginNames(undefined)).toEqual([])
    expect(installedPluginNames('')).toEqual([])
    expect(installedPluginNames(' , ')).toEqual([])
  })
})

describe('registerInstalledPlugins', () => {
  afterEach(() => vi.restoreAllMocks())

  // The stock OSS build. Importing this module must not put a tenant's
  // visualizations into the registry, because the product ships the core types
  // and nothing else.
  it('registers nothing on import, since the test env names no packages', () => {
    expect(registeredVisualizations().every((entry) => entry.origin === 'core')).toBe(true)
  })

  // A stale env var against a newer image should degrade the UI, not stop the
  // container. This is the same call the module makes at import, so a throw
  // here would be a boot failure rather than a missing type.
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

  // Registering the same package twice is a wiring bug, and the registry's
  // duplicate-type throw is what surfaces it. Papering over it here would hide
  // the case where two entry points both register.
  it('throws rather than silently re-registering', () => {
    expect(() => registerInstalledPlugins(['example'])).toThrow(/already registered/)
  })

  // The map is what the bundler sees, so a package missing from it is a
  // package that cannot be installed however the env var is spelled. Not an
  // exact list: a pack overlay build adds its own package directories on top
  // of this one, which is supported and must not break this assertion.
  it('names the example package, which the public build always carries', () => {
    expect(Object.keys(PLUGIN_PACKAGES)).toContain('example')
  })
})

// An invariant OF THE COMMUNITY REPOSITORY, and the only guard between customer
// plugin code and a public commit. It reads git, so it is a statement about
// what this checkout tracks and not about what any build renders.
//
// Skipped where feature packages are installed. A composed tree is assembled
// INSIDE the community checkout (build-overlay.sh refuses anywhere else, and
// says why), so its `git ls-files` is the host repository's and answers for a
// tree the composed run did not assemble. That is the same claim this file
// already meant to skip and could not express: the work-tree probe below was
// standing in for "an assembled overlay", which stopped being true the moment
// the overlay moved inside the repo. The registry states it directly.
describe.skipIf(!installsNoFeaturePackages())('tracked plugin packages', () => {
  // An exact `toEqual` against the one tenant package name here used to be
  // the whole confidentiality invariant: it failed the moment a customer
  // plugin package sat in this directory. It was relaxed to
  // `toContain('example')` above so a pack overlay build (which copies its
  // own package directory into src/plugins/ at image-build time) would not
  // fail this suite, but that relaxation quietly dropped the invariant it
  // was enforcing: if a tenant package directory were ever committed again,
  // prebuild would regenerate the registry to include it, the boundary test
  // and the generated-registry test would both accept it (neither compares
  // against anything but the filesystem), and `toContain('example')` would
  // not object either. Every test stays green while customer code sits in
  // the public source tree.
  //
  // This reads `git ls-files` rather than the filesystem on purpose: an
  // overlay copies a package directory onto disk but never commits it, so
  // it is visible to a readdir without ever being tracked by git. Customer
  // code re-entering the repo, by contrast, would be tracked. Do not
  // "simplify" this into a readdir; that swaps back to exactly the
  // filesystem-based check that cannot tell the two apart.
  it('tracks only the public plugin packages in git, regardless of what an overlay adds to disk', (ctx) => {
    // A tree with no .git gives this guard nothing to read. Skip rather than
    // fail: a red suite somewhere the question cannot be asked invites someone
    // to "fix" it by deleting the guard, which would retire it in the public
    // repo where it is the only thing standing between customer code and a
    // public commit. The composed overlay is no longer such a tree (it is
    // assembled inside the checkout), which is what the registry guard on the
    // describe above is for; this branch still covers a source copy taken
    // without .git, an image build context being the obvious one.
    //
    // Narrow on purpose. Only "not a work tree" skips; any other git failure
    // still fails, so the guard cannot go quiet in CI, where .git exists and
    // a missing git binary would be a real problem worth hearing about.
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
