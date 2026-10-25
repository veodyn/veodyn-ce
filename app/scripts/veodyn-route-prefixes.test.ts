import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { veodynRoutePrefixes } from './veodyn-route-prefixes.mjs'
import { prefixesAt, routePrefixDrift } from './check-route-prefix-drift.mjs'

const GENERATOR = join(process.cwd(), 'scripts/veodyn-route-prefixes.mjs')
const DRIFT = join(process.cwd(), 'scripts/check-route-prefix-drift.mjs')

let fixture: string | null = null

function makeApp(paths: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'route-prefixes-'))
  for (const path of paths) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), 'x\n')
  }
  fixture = root
  return root
}

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true })
  fixture = null
})

describe('veodynRoutePrefixes', () => {
  it('lists route directories, public entries and build output, and skips groups, private folders and files', () => {
    const app = makeApp([
      'src/app/page.tsx',
      'src/app/favicon.ico',
      'src/app/login/page.tsx',
      'src/app/api/health/route.ts',
      'src/app/(marketing)/about/page.tsx',
      'src/app/_internal/x.ts',
      'src/app/@modal/default.tsx',
      'public/icons/a.svg',
      'public/map-data/b.json',
    ])

    expect(veodynRoutePrefixes(app)).toEqual(['/_next', '/api', '/icons', '/login', '/map-data', '/packages'])
  })

  it('refuses a top-level dynamic route, which would leave the site nothing', () => {
    const app = makeApp(['src/app/[slug]/page.tsx'])

    expect(() => veodynRoutePrefixes(app)).toThrow(/top-level dynamic route/)
  })

  it('lists this app, including /home and the API', () => {
    const prefixes = veodynRoutePrefixes(process.cwd())

    expect(prefixes).toEqual(expect.arrayContaining(['/home', '/login', '/api', '/dashboards', '/_next', '/images']))
    expect(prefixes).not.toContain('/')
  })

  it('prints the list as JSON from the command line', () => {
    const app = makeApp(['src/app/login/page.tsx'])

    const run = spawnSync(process.execPath, [GENERATOR, app], { encoding: 'utf8' })

    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual(['/_next', '/login', '/packages'])
  })
})

describe('the drift check', () => {
  it('names what the values file is missing and what it has extra', () => {
    expect(routePrefixDrift(['/api', '/login'], ['/login', '/old'])).toEqual({ missing: ['/api'], extra: ['/old'] })
  })

  it('reads a nested list of strings and nothing else', () => {
    expect(prefixesAt({ ingress: { veodyn: ['/a'] } }, 'ingress.veodyn')).toEqual(['/a'])
    expect(prefixesAt({ ingress: {} }, 'ingress.veodyn')).toBeNull()
    expect(prefixesAt({ ingress: { veodyn: [1] } }, 'ingress.veodyn')).toBeNull()
  })

  it('passes a values file that matches, and fails one that drifted, from the command line', () => {
    const app = makeApp(['src/app/login/page.tsx', 'public/geo/x.json', 'values-ok.yaml', 'values-bad.yaml'])
    writeFileSync(join(app, 'values-ok.yaml'), 'site:\n  veodyn:\n    - /_next\n    - /geo\n    - /login\n    - /packages\n')
    writeFileSync(join(app, 'values-bad.yaml'), 'site:\n  veodyn:\n    - /_next\n    - /login\n    - /packages\n    - /gone\n')

    const ok = spawnSync(process.execPath, [DRIFT, join(app, 'values-ok.yaml'), '--key', 'site.veodyn', '--app', app], {
      encoding: 'utf8',
    })
    const bad = spawnSync(process.execPath, [DRIFT, join(app, 'values-bad.yaml'), '--key', 'site.veodyn', '--app', app], {
      encoding: 'utf8',
    })

    expect(ok.status).toBe(0)
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('missing from site.veodyn: /geo')
    expect(bad.stderr).toContain('extra in site.veodyn: /gone')
  })

  it('reads a JSON values file and an index into a list of hosts', () => {
    const app = makeApp(['src/app/login/page.tsx', 'values.json'])
    writeFileSync(
      join(app, 'values.json'),
      JSON.stringify({ app: { pathIngressHosts: [{ paths: ['/_next', '/login', '/packages'] }] } })
    )

    const run = spawnSync(
      process.execPath,
      [DRIFT, join(app, 'values.json'), '--key', 'app.pathIngressHosts.0.paths', '--app', app],
      { encoding: 'utf8' }
    )

    expect(run.status).toBe(0)
  })

  it('refuses a values file without the list rather than passing it', () => {
    const app = makeApp(['src/app/login/page.tsx', 'values.yaml'])
    writeFileSync(join(app, 'values.yaml'), 'other: 1\n')

    const run = spawnSync(process.execPath, [DRIFT, join(app, 'values.yaml'), '--app', app], { encoding: 'utf8' })

    expect(run.status).toBe(2)
  })
})
