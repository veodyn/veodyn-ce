import { Star } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { buildSidebarSections, type SidebarModelInput } from '@/lib/sidebar-nav'
import type { FeatureNavRow, NavSectionId } from '@/features'

// The neutral posture every existing assertion was written against: no
// optional surface switched on, and no admin of either kind.
const OFF = { query_snippets: false, query_drafts: false }
const SIGNED_IN: SidebarModelInput = {
  domains: [],
  canAccessAdmin: false,
  canViewInstanceAdmin: false,
  features: OFF,
}

function build(
  overrides: Partial<SidebarModelInput> = {},
  featureNav?: (section: NavSectionId) => FeatureNavRow[]
) {
  return buildSidebarSections({ ...SIGNED_IN, ...overrides }, featureNav)
}

// Stands in for an empty registry (no feature directories installed) without
// mocking @/features: buildSidebarSections takes the row lookup as an
// explicit input, and this passes an explicitly empty one, exercising the
// real splicing logic in sidebar-nav.ts rather than a stubbed module.
const NO_FEATURE_ROWS = (): FeatureNavRow[] => []

// One synthetic contributed row per section, passed through that same explicit
// input. What the cases using it prove is that this file splices a contributed
// row into the right section AND the right position within it, which is a
// property of the code here rather than of which packages a build installs.
// Asserting it through whatever the installed registry held made these cases
// pass or fail on the tree they ran in; which rows a shipped feature
// contributes is asserted by the build that installs it, in a suite that ships
// with it.
const STUB_ROWS: Record<NavSectionId, FeatureNavRow[]> = {
  library: [{ label: 'Alpha', href: '/alpha', icon: Star, section: 'library' }],
  monitor: [{ label: 'Beta', href: '/beta', icon: Star, section: 'monitor' }],
  admin: [{ label: 'Gamma', href: '/admin/gamma', icon: Star, section: 'admin' }],
}
const CONTRIBUTED_ROWS = (section: NavSectionId): FeatureNavRow[] => STUB_ROWS[section]

// An org admin, which in Redash means the "admin" permission and nothing
// stronger. The three instance-wide rows are gated on super_admin, so this is
// the posture that decides whether the nav lies to them.
const ORG_ADMIN: Partial<SidebarModelInput> = { canAccessAdmin: true }
const SUPER_ADMIN: Partial<SidebarModelInput> = {
  canAccessAdmin: true,
  canViewInstanceAdmin: true,
}

describe('buildSidebarSections', () => {
  it('returns the fixed primary group plus section groups, no admin by default', () => {
    const sections = build()
    // Library above Monitor: what people come here to open and author is the
    // everyday traffic, and monitoring is the exception they check when
    // something looks wrong.
    expect(sections.map((s) => s.id)).toEqual([
      'primary',
      'library',
      'monitor',
      'connect',
    ])
    const primary = sections.find((s) => s.id === 'primary')
    expect(primary?.items.map((i) => i.href)).toEqual([
      '/',
      '/search',
      '/data',
      '/discover',
      '/favorites',
    ])
  })

  // The API serves the published-feeds list to any org member, so gating the
  // row itself would hide a page a non-admin can actually read. Only the
  // create action inside the page is admin-gated.
  it('lists Feeds in CONNECT beside APIs and MCP', () => {
    const connect = build().find((s) => s.id === 'connect')
    expect(connect?.items.map((i) => i.href)).toEqual([
      '/connect/apis',
      '/connect/mcp',
      '/connect/feeds',
    ])
  })

  it('includes the ADMIN section only when canAccessAdmin is true', () => {
    expect(build().some((s) => s.id === 'admin')).toBe(false)
    expect(build(ORG_ADMIN).at(-1)?.id).toBe('admin')
  })

  // The whole ordered set for the strongest posture, contributed row included:
  // a row a feature contributes to ADMIN is spliced after the org-scoped CE
  // rows and before Plugins, and the three instance-wide rows still come last.
  it('lists the full ADMIN item set for a super admin', () => {
    const adminSection = build(SUPER_ADMIN, CONTRIBUTED_ROWS).find((s) => s.id === 'admin')
    expect(adminSection?.items.map((i) => i.href)).toEqual([
      '/data-sources',
      '/destinations',
      '/users',
      '/admin/gamma',
      '/admin/plugins',
      '/settings',
      '/admin/status',
      '/admin/jobs',
      '/admin/outdated',
    ])
  })

  // The three instance-wide pages read Redash endpoints Redash gates with
  // super_admin, and /api/admin/* gates the same way, so offering them to an
  // org admin is offering three links that answer 403. A contributed row is
  // present here and unaffected by that gating: the section it names is the
  // only signal it carries, so it is org-scoped like the CE rows around it.
  it('keeps the instance-wide rows out of an org admin nav', () => {
    const adminSection = build(ORG_ADMIN, CONTRIBUTED_ROWS).find((s) => s.id === 'admin')
    expect(adminSection?.items.map((i) => i.href)).toEqual([
      '/data-sources',
      '/destinations',
      '/users',
      '/admin/gamma',
      '/admin/plugins',
      '/settings',
    ])
  })

  // Plugins sits under /admin like the three gated pages but reads the
  // client-side registry rather than a Redash endpoint, so it is the one
  // /admin row an org admin can open. Pinned because putting it in the gated
  // group would hide it from exactly the admins who install plugins.
  it('offers the plugins page to an org admin', () => {
    const hrefs = build(ORG_ADMIN)
      .find((s) => s.id === 'admin')
      ?.items.map((i) => i.href)
    expect(hrefs).toContain('/admin/plugins')
  })

  it('appends config domains as Data hub links', () => {
    const primary = build({ domains: [{ key: 'transit', label: 'Transit' }] }).find(
      (s) => s.id === 'primary'
    )
    expect(
      primary?.items.some((i) => i.href === '/data/transit' && i.label === 'Transit')
    ).toBe(true)
  })

  // The flag, from both sides. Off is the default posture, so the row has to be
  // absent unless an instance asked for it.
  it('leaves Query Snippets out of LIBRARY unless the feature is on', () => {
    const library = build({}, CONTRIBUTED_ROWS).find((s) => s.id === 'library')
    expect(library?.items.some((i) => i.href === '/query-snippets')).toBe(false)
    // And the rest of the section is untouched by its absence: the two CE rows,
    // then whatever the registry contributes.
    expect(library?.items.map((i) => i.href)).toEqual(['/queries', '/dashboards', '/alpha'])
  })

  it('lists Query Snippets in LIBRARY when the feature is on', () => {
    const library = build(
      { features: { query_snippets: true, query_drafts: true } },
      CONTRIBUTED_ROWS
    ).find((s) => s.id === 'library')
    // Last, after the contributed rows: an instance switch is not a reason to
    // reorder the section around it.
    expect(library?.items.map((i) => i.href)).toEqual([
      '/queries',
      '/dashboards',
      '/alpha',
      '/query-snippets',
    ])
    expect(library?.items.at(-1)?.label).toBe('Query Snippets')
  })

  // The stock, feature-free build: no contributed rows at all, which an empty
  // registry represents honestly with NO_FEATURE_ROWS rather than by mocking
  // @/features.
  describe('with no feature nav rows (an empty registry)', () => {
    it('keeps LIBRARY present with just the CE rows, not empty', () => {
      const library = build({}, NO_FEATURE_ROWS).find((s) => s.id === 'library')
      expect(library?.items.map((i) => i.href)).toEqual(['/queries', '/dashboards'])
    })

    it('keeps MONITOR present with just the CE rows, not empty', () => {
      const monitor = build({}, NO_FEATURE_ROWS).find((s) => s.id === 'monitor')
      expect(monitor?.items.map((i) => i.href)).toEqual(['/feed-health', '/schedules'])
    })

    it('keeps ADMIN present with just the CE rows, not empty', () => {
      const admin = build(SUPER_ADMIN, NO_FEATURE_ROWS).find((s) => s.id === 'admin')
      expect(admin?.items.map((i) => i.href)).toEqual([
        '/data-sources',
        '/destinations',
        '/users',
        '/admin/plugins',
        '/settings',
        '/admin/status',
        '/admin/jobs',
        '/admin/outdated',
      ])
    })

    it('never collapses a section to zero items', () => {
      const sections = build(SUPER_ADMIN, NO_FEATURE_ROWS)
      for (const section of sections) {
        expect(section.items.length).toBeGreaterThan(0)
      }
    })
  })
})
