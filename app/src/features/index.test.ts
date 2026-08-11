import { Bell, Star } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { buildSidebarSections, type SidebarModelInput } from '@/lib/sidebar-nav'
import {
  FEATURES,
  featureList,
  featureNavRows,
  featureRouteFor,
  featureSearchTypes,
  hasFeature,
  installsNoFeaturePackages,
  type FeatureDescriptor,
} from './index'

// Two synthetic descriptors, and the reason they are synthetic rather than the
// real ones this repository used to hold.
//
// Every helper below is a function OVER a registry, and what it has to get
// right is the traversal: sorted by key, one row per matching section, a
// searchType only where a descriptor declares one, the first route pattern
// that matches. None of that is a property of which features an edition ships,
// and asserting it through whatever `FEATURES` happens to hold made the suite
// silently depend on the build it ran in. It passed for months and then failed
// on the commit that emptied the registry, without a single one of these
// functions having changed.
//
// So the mechanism is pinned here against a fixture, and the CONTENT (which
// rows a shipped feature contributes, which routes it claims) is asserted by
// the build that installs it, in a suite that ships with it. `beta` sorts
// after `alpha`, and it is declared FIRST, so featureList's sort is doing work
// rather than agreeing with the literal order.
const STUB: Record<string, FeatureDescriptor> = {
  beta: {
    id: 'beta',
    nav: [
      { label: 'Beta', href: '/beta', icon: Bell, section: 'monitor' },
      { label: 'Beta Admin', href: '/admin/beta', icon: Bell, section: 'admin' },
    ],
    routes: [{ pattern: /^\/beta\/[^/]+\/show\/?$/, bareChrome: true, forcedTheme: 'dark' }],
  },
  alpha: {
    id: 'alpha',
    nav: [{ label: 'Alpha', href: '/alpha', icon: Star, section: 'library' }],
    searchType: { type: 'alpha', label: 'Alpha', noun: 'alpha', icon: Star },
    routes: [{ pattern: /^\/alpha\/print\/?$/, forcedTheme: 'light' }],
  },
}

describe('featureNavRows', () => {
  it('returns one section of rows, in featureList order', () => {
    expect(featureNavRows('library', STUB).map((row) => row.label)).toEqual(['Alpha'])
    expect(featureNavRows('monitor', STUB).map((row) => row.label)).toEqual(['Beta'])
    expect(featureNavRows('admin', STUB).map((row) => row.label)).toEqual(['Beta Admin'])
  })

  it('gives a row no section other than its own', () => {
    const everySection = [
      ...featureNavRows('library', STUB),
      ...featureNavRows('monitor', STUB),
      ...featureNavRows('admin', STUB),
    ]
    expect(everySection).toHaveLength(3)
  })

  // A row carries no admin flag of its own: section: 'admin' is the only
  // gating signal, because the 'admin' sidebar section itself renders only for
  // admins. This proves that gating actually holds end to end, through the
  // consumer that matters, rather than asserting a flag that nothing reads.
  // Driven through buildSidebarSections's own featureNav parameter so it is the
  // splicing logic under test and not the installed registry.
  it('gates an admin row behind canAccessAdmin, via the admin section it lives in', () => {
    const base: SidebarModelInput = {
      domains: [],
      canAccessAdmin: true,
      canViewInstanceAdmin: false,
      features: { query_snippets: false, query_drafts: false },
    }
    const featureNav = (section: Parameters<typeof featureNavRows>[0]) => featureNavRows(section, STUB)

    const adminSection = buildSidebarSections(base, featureNav).find((s) => s.id === 'admin')
    expect(adminSection?.items.some((i) => i.href === '/admin/beta')).toBe(true)

    const nonAdminSections = buildSidebarSections({ ...base, canAccessAdmin: false }, featureNav)
    expect(nonAdminSections.some((s) => s.id === 'admin')).toBe(false)
  })
})

describe('featureSearchTypes', () => {
  it('returns a type per descriptor that declares one, and skips the ones that do not', () => {
    expect(featureSearchTypes(STUB).map((searchType) => searchType.type)).toEqual(['alpha'])
  })
})

describe('featureRouteFor', () => {
  it('matches a route a descriptor claims, and carries its chrome and theme', () => {
    const route = featureRouteFor('/beta/7/show', STUB)
    expect(route).toBeDefined()
    expect(route?.forcedTheme).toBe('dark')
    expect(route?.bareChrome).toBe(true)
  })

  // The patterns are exact RegExps rather than prefixes precisely so a parent
  // path does not inherit a child's chrome.
  it('does not match a path the pattern excludes', () => {
    expect(featureRouteFor('/beta/7', STUB)).toBeUndefined()
  })

  it('finds a second descriptor s route, not only the first one it walks', () => {
    expect(featureRouteFor('/alpha/print', STUB)?.forcedTheme).toBe('light')
  })
})

describe('the registry itself', () => {
  it('gives every descriptor an id equal to its own key', () => {
    for (const [key, feature] of Object.entries(FEATURES)) {
      expect(feature.id).toBe(key)
    }
  })

  it('sorts featureList() by key', () => {
    expect(featureList(STUB).map((feature) => feature.id)).toEqual(['alpha', 'beta'])
  })

  it('answers hasFeature for a package it holds and for one it does not', () => {
    expect(hasFeature('alpha', STUB)).toBe(true)
    expect(hasFeature('forecast', STUB)).toBe(false)
    // Not an own property, so a registry that answered by prototype lookup
    // would call every build's toString a feature.
    expect(hasFeature('toString', STUB)).toBe(false)
  })
})

// The empty case, passed EXPLICITLY rather than relied on as the default.
//
// The stock build installs no package, so `featureNavRows('library')` and
// `featureNavRows('library', {})` return the same thing here and the bare form
// looks like the more honest one to write. It is not, and the reason is the
// other direction: an overlay build assembles feature packages into this tree
// and runs this same file, where every bare call would answer with four
// installed features and every assertion below would be false. A suite that
// only passes in one of the two builds it ships to is a suite that has to be
// excluded from a run, and an excluded suite guards nothing.
//
// So nothing in this file reads the default registry. What each build's own
// registry actually holds is that build's business, asserted where the packages
// are.
describe('the registry helpers against an empty registry', () => {
  it('featureList returns nothing', () => {
    expect(featureList({})).toEqual([])
  })

  it('featureNavRows returns nothing for every section', () => {
    expect(featureNavRows('library', {})).toEqual([])
    expect(featureNavRows('monitor', {})).toEqual([])
    expect(featureNavRows('admin', {})).toEqual([])
  })

  it('featureSearchTypes returns nothing', () => {
    expect(featureSearchTypes({})).toEqual([])
  })

  it('featureRouteFor finds nothing, not even a route a descriptor really owns', () => {
    expect(featureRouteFor('/beta/7/show', {})).toBeUndefined()
    expect(featureRouteFor('/alpha/print', {})).toBeUndefined()
  })

  it('hasFeature answers false for every key, including one a fixture holds', () => {
    expect(hasFeature('alpha', {})).toBe(false)
    expect(hasFeature('beta', {})).toBe(false)
  })

  // The predicate the community-repository invariants guard themselves with.
  // Pinned against fixtures for the same reason as everything else in this
  // file: what the DEFAULT registry holds is a fact about the build, and this
  // suite runs in two of them.
  it('installsNoFeaturePackages answers for the registry it is given', () => {
    expect(installsNoFeaturePackages({})).toBe(true)
    expect(installsNoFeaturePackages(STUB)).toBe(false)
    // One package is enough. The question is whether ANY feature is installed,
    // not whether the four this pack happens to ship all are.
    expect(installsNoFeaturePackages({ alpha: STUB.alpha })).toBe(false)
  })
})
