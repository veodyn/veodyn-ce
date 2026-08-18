// The enterprise routes community code is allowed to name, and the ones it is
// not.
//
// A URL is a string and no compiler can see one: src/app/kpis is not in this
// tree, so `<Link href="/kpis">` in a community file type-checks, lints and
// unit-tests perfectly and 404s in the browser. Seven of the nine sites that
// existed when this file was written type-checked clean.
//
// Same allowlist-not-denylist structure as feature-boundary.test.ts next door:
// the enterprise routes are DERIVED from scripts/enterprise-paths.mjs (see
// routePrefixes in enterprise-route-scan.ts), never re-listed, so a route
// directory added to that list arms this guard for it on the same commit.
//
// The scanning mechanics live in enterprise-route-scan.ts, split out for file
// size only.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installsNoFeaturePackages } from './index'
import {
  FILES,
  PREFIXES,
  code,
  isSkipped,
  literalsIn,
  routeLinksIn,
  routePrefixes,
  scanTree,
  type RouteLink,
} from './enterprise-route-scan'

/**
 * A community file that may name an enterprise route, the exact literals it
 * may name, and why.
 *
 * The reason is required: without one this list rots into a record of everything
 * anyone ever added, which is the same thing as no guard at all. The LITERALS
 * are pinned as well as the path, so an entry excuses the link that was argued
 * for and not the file: a second, different enterprise link added to an
 * allowlisted file still fails.
 */
interface Exemption {
  file: string
  literals: string[]
  reason: string
}

const ALLOWED: Exemption[] = [
  {
    file: 'src/middleware.ts',
    literals: ['/reports/public'],
    reason:
      'Route MATCHING, not a link. It is an entry in the unauthenticated-route allowlist, so in a build with no reports feature it matches nothing and costs nothing: no page is served either way, and the only difference is whether a request that was going to 404 is redirected to /login first. Sourcing it from the registry would be worse than hardcoding it, for the reason authenticated-layout.tsx gives below.',
  },
  {
    file: 'src/components/layout/authenticated-layout.tsx',
    literals: ['/reports/public/'],
    reason:
      'Route matching again: the branch that strips the app shell off an anonymously shared report. It must keep working in a build with no reports package installed, because it serves people with no account at all, so it deliberately cannot come from that feature\'s registry entry. The file says so at the site, and says not to "finish the job" by folding it in.',
  },
  {
    file: 'src/components/feeds/expected-interval-control.tsx',
    literals: ['/alerts/${feed.alertId}'],
    reason:
      'Feeds are community and alerts are enterprise, and this is the one link between them: the Recipients button on a feed that is armed to alert. Rendered only when the alerts feature is installed (hasFeature, features/index.ts), so a community build shows the row one button shorter instead of offering a 404. The literal stays because the link is real wherever the destination is, and a slot would be the wrong shape for it: the feature contributes no component and no data here, and the community surface already knows the whole href.',
  },
  {
    file: 'src/app/dashboards/[dashboardId]/dashboard-view-actions.tsx',
    literals: ['/present/${dashboard.id}'],
    reason:
      'The dashboard toolbar is community and /present belongs to the wall package, which owns both /wall and /present and contributes no nav row or component of its own. Gated on hasFeature(\'wall\'), so the Present button is absent from a community build rather than dead in it. Same shape and same reasoning as the feeds link above.',
  },
]

function format(link: RouteLink): string {
  return `${link.file}:${link.line} ${JSON.stringify(link.literal)}`
}

function isAllowed(link: RouteLink): boolean {
  return ALLOWED.some((entry) => entry.file === link.file && entry.literals.includes(link.literal))
}

// An invariant OF THE COMMUNITY REPOSITORY: no module in this tree names a
// route that leaves with the pack, because in this build those routes do not
// exist and the link would 404.
//
// A composed tree is the build where they DO exist, and where linking to them is
// correct. The scanner cannot tell the difference, because it reads paths and
// not the registry, so this case is skipped where the destinations are installed
// rather than rewritten into something that asserts nothing in either build.
//
// The self-checks below are NOT skipped: every one of them is true of any build.
describe.skipIf(!installsNoFeaturePackages())('enterprise routes named by community code', () => {
  it('no community module links to a route the enterprise pack takes with it', () => {
    expect(scanTree().filter((link) => !isAllowed(link)).map(format)).toEqual([])
  })
})

// A guard that matches nothing is a guard that cannot fail. Everything below
// pins that this one reads real code, derives the right routes, and holds an
// allowlist that cannot quietly outlive what it excuses.
describe('enterprise route guard, self-checks', () => {
  it('scans real source files', () => {
    expect(FILES.length).toBeGreaterThan(0)
  })

  it('scans the community surfaces this guard was written for', () => {
    for (const file of ['src/app/favorites/page.tsx', 'src/app/page.tsx', 'src/middleware.ts']) {
      expect(FILES, `${file} must be scanned`).toContain(file)
    }
  })

  // Asserted through isSkipped rather than through FILES: `FILES` cannot contain
  // src/app/kpis/page.tsx because that file is not in this tree at all, so
  // `expect(FILES).not.toContain(...)` would pass with the skip branch deleted.
  // isSkipped answers for a path whether or not it exists, which is what an
  // overlay build (where those files ARE present) depends on.
  it('skips a path the enterprise pack owns, and scans a community one', () => {
    expect(isSkipped(join('src', 'app', 'kpis', 'page.tsx'))).toBe(true)
    expect(isSkipped(join('src', 'lib', 'ai-digest.ts'))).toBe(true)
    // A community module inside no owned directory is scanned.
    expect(isSkipped(join('src', 'app', 'feed-health', 'page.tsx'))).toBe(false)
    expect(FILES).toContain('src/app/feed-health/page.tsx')
  })

  it('derives one URL prefix per enterprise route directory, and nothing from a module', () => {
    expect(PREFIXES).toEqual(expect.arrayContaining(['/kpis', '/reports', '/alerts', '/wall', '/present']))
    // Every prefix is a URL, never a source path: an entry that names a
    // file or a directory outside src/app has no route to derive.
    expect(PREFIXES.every((prefix) => prefix.startsWith('/') && !prefix.includes('.'))).toBe(true)
    expect(
      routePrefixes(['src/app/kpis', 'src/app/admin/shared-links', 'src/lib/kpi-id.ts', 'src/components/kpi'])
    ).toEqual(['/admin/shared-links', '/kpis'])
  })

  it('reads a plain string, a template literal and neither of them from a comment', () => {
    expect(literalsIn(`const href = '/kpis'`).map((l) => l.text)).toEqual(['/kpis'])
    expect(literalsIn('const href = `/kpis/${id}`').map((l) => l.text)).toEqual(['/kpis/${id}'])
    expect(literalsIn(`// a link to '/kpis' would be wrong`)).toEqual([])
    expect(literalsIn('/* a link to `/kpis` would be wrong */')).toEqual([])
    // An apostrophe in prose must not open a string that swallows the file.
    expect(literalsIn(`// the wall's own route\nconst href = '/wall'`).map((l) => l.text)).toEqual(['/wall'])
  })

  it('reports the line the literal opens on', () => {
    expect(routeLinksIn('x.ts', `const a = 1\n\nconst href = '/reports/42'`)).toEqual([
      { file: 'x.ts', line: 3, literal: '/reports/42' },
    ])
  })

  it('matches on a segment boundary, so a community route that merely starts the same passes', () => {
    expect(routeLinksIn('x.ts', `const a = '/reportsmith'\nconst b = '/kpis-archive'`)).toEqual([])
    expect(routeLinksIn('x.ts', `const a = '/reports'`).map((l) => l.literal)).toEqual(['/reports'])
    expect(routeLinksIn('x.ts', `const a = '/kpis?tag=x'`).map((l) => l.literal)).toEqual(['/kpis?tag=x'])
  })

  // The case the scanner does not report: heatmap-grid-chrome.ts explains a
  // layout rule by naming `/present` in a sentence. A route in prose is not a
  // link, unlike an import specifier in a comment, which is why this file strips
  // comments where feature-boundary-scan does not.
  it('does not read a route named in a comment as a link', () => {
    const source = code('src/components/visualizations/heatmap-grid-chrome.ts')
    expect(source).toContain('/present')
    expect(routeLinksIn('src/components/visualizations/heatmap-grid-chrome.ts', source)).toEqual([])
  })

  it('catches a link planted in a community file, naming the file, the line and the literal', () => {
    const planted = `import Link from 'next/link'\nexport const X = () => <Link href="/kpis/7" />`
    expect(routeLinksIn('src/app/page.tsx', planted).map(format)).toEqual([
      'src/app/page.tsx:2 "/kpis/7"',
    ])
  })

  it('holds no allowlist entry that has outlived what it excused', () => {
    const live = scanTree()
    for (const entry of ALLOWED) {
      expect(FILES, `${entry.file} is allowlisted but not scanned`).toContain(entry.file)
      for (const literal of entry.literals) {
        expect(
          live.some((link) => link.file === entry.file && link.literal === literal),
          `${entry.file} is allowlisted for ${JSON.stringify(literal)}, which it no longer contains`
        ).toBe(true)
      }
    }
  })

  it('gives every allowlist entry a written reason', () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.length, `${entry.file} needs a reason, not just a path`).toBeGreaterThan(80)
    }
  })
})
