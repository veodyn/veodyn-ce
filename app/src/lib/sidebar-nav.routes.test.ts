// Favorites, Schedules and Folders all shipped in the sidebar pointing at
// routes that did not exist. Each one highlighted as the active nav item and
// then rendered Next's default 404, with no recovery link. Nothing caught it,
// because the nav model and the route tree were only ever checked separately.
//
// This walks the real app directory, so a nav item added without a page fails
// here rather than in someone's browser.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSidebarSections } from '@/lib/sidebar-nav'

const APP_DIR = join(process.cwd(), 'src', 'app')

/** Does this URL path resolve to a page in the App Router tree? */
function routeExists(href: string): boolean {
  const segments = href.split('/').filter(Boolean)
  let dir = APP_DIR

  for (const segment of segments) {
    const exact = join(dir, segment)
    if (existsSync(exact)) {
      dir = exact
      continue
    }
    // A dynamic segment: /data/rail is served by src/app/data/[domain]. Route
    // groups like (app) are not used here, so this is the only indirection.
    const dynamic = readdirSync(dir, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name.startsWith('[')
    )
    if (!dynamic) return false
    dir = join(dir, dynamic.name)
  }

  return ['page.tsx', 'page.ts', 'page.jsx', 'page.js'].some((file) => existsSync(join(dir, file)))
}

const sections = buildSidebarSections({
  domains: [{ key: 'rail', label: 'Rail', icon: 'train' }],
  canAccessAdmin: true,
  // Both admin tiers, and every optional surface on, so this sweep still
  // checks the routes behind them: anything switched off here would silently
  // stop being covered.
  canViewInstanceAdmin: true,
  features: { query_snippets: true, query_drafts: true },
})
const allItems = sections.flatMap((section) => section.items)

describe('every sidebar destination is a real route', () => {
  it.each(allItems.map((item) => [item.label, item.href]))('%s goes to %s', (_label, href) => {
    expect(routeExists(href)).toBe(true)
  })

  it('checked a meaningful number of them', () => {
    // A guard on the guard: if buildSidebarSections ever returns nothing, the
    // it.each above silently passes zero cases.
    expect(allItems.length).toBeGreaterThan(15)
  })

  it('recognises a route that is not there', () => {
    expect(routeExists('/folders')).toBe(false)
  })
})
