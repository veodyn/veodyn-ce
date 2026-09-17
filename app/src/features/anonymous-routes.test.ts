import { describe, expect, it } from 'vitest'
import {
  aFeatureMayDeclareThisAnonymous,
  anonymousFeaturePaths,
  embeddableFeaturePaths,
  isAnonymousFeaturePath,
  isAnonymousPath,
  isEmbeddableFeaturePath,
  isEmbeddablePath,
  matchesRoutePattern,
  undeclarableAnonymousPaths,
} from '@/features/anonymous-routes'
import type { FeatureDescriptor } from '@/features/types'

function registryDeclaring(...paths: { path: string; embeddable?: boolean }[]): Record<string, FeatureDescriptor> {
  return {
    messages: { id: 'messages', nav: [], routes: [], anonymousRoutes: paths },
  }
}

describe('what a feature package is allowed to declare session-less', () => {
  it.each([
    '/service-alerts/public',
    '/messages/public',
    '/a/b/public',
    '/a/b/c/public',
    '/kebab-case-segment/public',
    '/messages/public/[token]',
    '/service-alerts/public/[slug]',
    '/service-alerts/public/[slug]/banner',
    '/settings/public/deep',
  ])('accepts %s, whose route is rooted at a literal public segment', (path) => {
    expect(aFeatureMayDeclareThisAnonymous(path)).toBe(true)
  })

  it.each([
    '/',
    '/admin',
    '/settings',
    '/users',
    '/public',
    '/queries/1',
    '/Admin/public',
    '/admin/public/',
    'admin/public',
    '/admin/../public',
    '/admin/*/public',
    '/admin/publicity',
    '/admin/publications',
    '/a/b/c/d/public',
    '/[tenant]/public',
    '/messages/public/[...rest]',
    '/messages/public/[[...rest]]',
  ])('refuses %s, so a package cannot widen the gate onto it', (path) => {
    expect(aFeatureMayDeclareThisAnonymous(path)).toBe(false)
  })
})

describe('a declaration names one route, not a subtree', () => {
  it('matches the pattern it was written as and nothing below it', () => {
    expect(matchesRoutePattern('/messages/public/msg_abc', '/messages/public/[token]')).toBe(true)
    expect(matchesRoutePattern('/messages/public', '/messages/public/[token]')).toBe(false)
    expect(matchesRoutePattern('/messages/public/msg_abc/edit', '/messages/public/[token]')).toBe(false)
    expect(matchesRoutePattern('/messages/publicity/msg_abc', '/messages/public/[token]')).toBe(false)
    expect(matchesRoutePattern('/messages/public/', '/messages/public/[token]')).toBe(false)
  })

  it('does not let the declared root stand in for a descendant, or the reverse', () => {
    const registry = registryDeclaring({ path: '/messages/public/[token]' })

    expect(isAnonymousFeaturePath('/messages/public/msg_abc', registry)).toBe(true)
    expect(isAnonymousFeaturePath('/messages/public', registry)).toBe(false)
    expect(isAnonymousFeaturePath('/messages/msg_abc', registry)).toBe(false)
  })

  it('leaves an undeclared sibling of a declared route gated', () => {
    const registry = registryDeclaring({ path: '/service-alerts/public/[slug]' })

    expect(isAnonymousFeaturePath('/service-alerts/public/agency-one', registry)).toBe(true)
    expect(isAnonymousFeaturePath('/service-alerts/public/agency-one/banner', registry)).toBe(false)
    expect(isAnonymousFeaturePath('/service-alerts/public/agency-one/edit', registry)).toBe(false)
  })
})

describe('reading the declarations out of a registry', () => {
  it('reports nothing at all for a build that installs no feature packages', () => {
    expect(anonymousFeaturePaths({})).toEqual([])
    expect(embeddableFeaturePaths({})).toEqual([])
    expect(isAnonymousFeaturePath('/service-alerts/public/agency', {})).toBe(false)
  })

  it('drops a declaration outside the allowed shape rather than honouring it', () => {
    const registry = registryDeclaring({ path: '/admin' }, { path: '/service-alerts/public/[slug]' })

    expect(anonymousFeaturePaths(registry)).toEqual(['/service-alerts/public/[slug]'])
    expect(isAnonymousFeaturePath('/admin/status', registry)).toBe(false)
    expect(isAnonymousFeaturePath('/admin', registry)).toBe(false)
  })

  it('names a dropped declaration so a guard can fail on it instead of it being silent', () => {
    const registry = registryDeclaring({ path: '/admin' }, { path: '/service-alerts/public' })

    expect(undeclarableAnonymousPaths(registry)).toEqual(['/admin'])
    expect(undeclarableAnonymousPaths({})).toEqual([])
  })

  it('grants framing only to the exact route that asked for it', () => {
    const registry = registryDeclaring(
      { path: '/service-alerts/public/[slug]' },
      { path: '/service-alerts/public/[slug]/banner', embeddable: true },
      { path: '/messages/public/[token]' }
    )

    expect(embeddableFeaturePaths(registry)).toEqual(['/service-alerts/public/[slug]/banner'])
    expect(isEmbeddableFeaturePath('/service-alerts/public/agency-one/banner', registry)).toBe(true)
    expect(isEmbeddableFeaturePath('/service-alerts/public/agency-one', registry)).toBe(false)
    expect(isEmbeddableFeaturePath('/messages/public/tok', registry)).toBe(false)
    expect(isAnonymousFeaturePath('/service-alerts/public/agency-one', registry)).toBe(true)
    expect(isAnonymousFeaturePath('/messages/public/tok', registry)).toBe(true)
  })
})

describe('the one classification middleware and the shell both read', () => {
  it.each([
    '/login',
    '/mcp',
    '/invite/tok',
    '/reset/tok',
    '/embed/public/abc',
    '/embed/query/1/visualization/2',
    '/dashboards/public/abc',
    '/reports/public/abc',
  ])('answers yes for the community route %s', (pathname) => {
    expect(isAnonymousPath(pathname, {})).toBe(true)
  })

  it.each([
    '/',
    '/embed',
    '/invite',
    '/reset',
    '/dashboards/public',
    '/reports/public',
    '/reports/publications',
    '/dashboards/publications',
    '/mcp-admin',
    '/loginhistory',
    '/embedded-reports',
    '/users',
  ])('answers no for %s, the declared root among them', (pathname) => {
    expect(isAnonymousPath(pathname, {})).toBe(false)
  })

  it('frames the community embeddable routes and refuses the sign-in surfaces', () => {
    expect(isEmbeddablePath('/embed/public/abc', {})).toBe(true)
    expect(isEmbeddablePath('/dashboards/public/abc', {})).toBe(true)
    expect(isEmbeddablePath('/reports/public/abc', {})).toBe(true)
    expect(isEmbeddablePath('/login', {})).toBe(false)
    expect(isEmbeddablePath('/invite/tok', {})).toBe(false)
    expect(isEmbeddablePath('/reset/tok', {})).toBe(false)
  })

  it('adds a package declaration to the community set without widening it', () => {
    const registry = registryDeclaring({ path: '/messages/public/[token]' })

    expect(isAnonymousPath('/messages/public/tok', registry)).toBe(true)
    expect(isAnonymousPath('/messages/tok', registry)).toBe(false)
    expect(isAnonymousPath('/login', registry)).toBe(true)
  })
})

describe('the registry this build actually ships', () => {
  it('declares nothing outside the allowed shape', () => {
    expect(undeclarableAnonymousPaths()).toEqual([])
  })
})
