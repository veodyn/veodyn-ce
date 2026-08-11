// The pure half of the theme vocabulary: what a preference resolves to, what
// counts as one, and which surfaces overrule it. The pre-paint script that
// serialises the same forced-theme table is exercised next door in
// theme-init-script.test.ts, which needs a document and a location and so was
// split out rather than sharing this file.
import { describe, expect, it } from 'vitest'
import {
  THEME_PREFERENCES,
  forcedTheme,
  isThemePreference,
  resolveTheme,
} from '@/lib/theme-preference'
import { STUB_REGISTRY } from '@/lib/theme-preference-fixtures'

describe('resolveTheme', () => {
  it('returns an explicit choice regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the OS when the choice is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('isThemePreference', () => {
  it.each(THEME_PREFERENCES)('accepts %s', (value) => {
    expect(isThemePreference(value)).toBe(true)
  })

  it.each([['auto'], [''], ['DARK'], [null], [undefined], [1]])(
    'rejects %s, so a stale or hand-edited value cannot reach the app',
    (value) => {
      expect(isThemePreference(value)).toBe(false)
    },
  )
})

describe('forcedTheme', () => {
  // Not feature-owned: the embed rule applies to every embeddable surface this
  // product ships, so it stays hardcoded and is asserted against the real table.
  it('forces an embedded widget light', () => {
    expect(forcedTheme('/embed/query/1')).toBe('light')
  })

  // Driven by an explicit registry: what this pins is that a rule a descriptor
  // declares wins over the reader's preference, whichever theme it names and
  // whichever descriptor declares it.
  it.each([
    ['/beta', 'dark'],
    ['/beta/7', 'dark'],
    ['/alpha/42/paper', 'light'],
    ['/alpha/42/paper/', 'light'],
  ])('forces %s to %s from the rule a descriptor declares', (pathname, expected) => {
    expect(forcedTheme(pathname, STUB_REGISTRY)).toBe(expected)
  })

  // The patterns are exact rather than prefixes, which is what keeps a
  // neighbouring path, and a leaf route's parent, on the reader's preference.
  it.each([['/betamax'], ['/alpha/42'], ['/alpha']])(
    'leaves %s to the reader, since no declared pattern matches it',
    (pathname) => {
      expect(forcedTheme(pathname, STUB_REGISTRY)).toBeNull()
    }
  )

  // The community answer, from the registry this build installs: with no
  // feature package claiming a route, every one of these follows the reader,
  // including the neighbours of the surfaces a fuller build forces.
  it.each([
    ['/'],
    ['/queries'],
    ['/reports/42'],
    ['/reports/publications'],
    ['/wallpaper'],
    ['/presentations'],
    ['/embedded'],
  ])('leaves %s to the reader', (pathname) => {
    expect(forcedTheme(pathname)).toBeNull()
  })
})

// The print and wall/present style rules are feature-owned and come from the
// registry seam; embed is not and stays hardcoded. Passing an explicit empty
// registry exercises the real empty-build path without mocking @/features,
// the same pattern featureRouteFor's own tests use.
describe('forcedTheme against an empty registry', () => {
  it('still forces an embedded widget light', () => {
    expect(forcedTheme('/embed/query/1', {})).toBe('light')
  })

  it('no longer forces the print route, which reverts to the reader default', () => {
    expect(forcedTheme('/reports/42/print', {})).toBeNull()
  })

  it('no longer forces the wall or present routes, which revert to the reader default', () => {
    expect(forcedTheme('/wall', {})).toBeNull()
    expect(forcedTheme('/present/7', {})).toBeNull()
  })

  it('still leaves an ordinary route to the reader with the real registry', () => {
    expect(forcedTheme('/queries')).toBeNull()
  })
})

// A pathname that could satisfy a print-style rule under the public-report
// prefix: /reports/public/print reads as report id "public". With nothing
// claiming that route it follows the reader, and authenticated-layout.tsx
// still renders it bare from its own hardcoded /reports/public/ prefix, which
// is the branch anonymous access depends on and which no registry feeds. A
// build with a reporting surface installed asserts the forced answer for this
// path in its own suite.
describe('forcedTheme for a path that could read as a public report', () => {
  it('leaves /reports/public/print to the reader with nothing claiming it', () => {
    expect(forcedTheme('/reports/public/print', {})).toBeNull()
  })
})
