import { FEATURES } from './generated-registry'
import type { AnonymousRoute, FeatureDescriptor } from './types'

type Registry = Record<string, FeatureDescriptor>

const LITERAL_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DYNAMIC_SEGMENT = /^\[[A-Za-z][A-Za-z0-9]*\]$/
const PUBLIC_SEGMENT = 'public'
const MAX_DECLARED_SEGMENTS = 4

function isDynamicSegment(segment: string): boolean {
  return DYNAMIC_SEGMENT.test(segment)
}

export function routePatternSegments(pattern: string): string[] | null {
  if (!pattern.startsWith('/') || pattern.length === 1) return null
  const segments = pattern.slice(1).split('/')
  const wellFormed = segments.every(
    (segment) => LITERAL_SEGMENT.test(segment) || DYNAMIC_SEGMENT.test(segment)
  )
  return wellFormed ? segments : null
}

export function aFeatureMayDeclareThisAnonymous(pattern: string): boolean {
  const segments = routePatternSegments(pattern)
  if (segments === null) return false
  if (segments.length < 2 || segments.length > MAX_DECLARED_SEGMENTS) return false

  const publicAt = segments.indexOf(PUBLIC_SEGMENT)
  if (publicAt < 1) return false

  return !segments.slice(0, publicAt).some(isDynamicSegment)
}

export function matchesRoutePattern(pathname: string, pattern: string): boolean {
  const patternSegments = routePatternSegments(pattern)
  if (patternSegments === null || !pathname.startsWith('/')) return false

  const pathSegments = pathname.slice(1).split('/')
  if (pathSegments.length !== patternSegments.length) return false

  return patternSegments.every((segment, index) =>
    isDynamicSegment(segment) ? pathSegments[index].length > 0 : pathSegments[index] === segment
  )
}

export const COMMUNITY_ANONYMOUS_ROUTES: readonly AnonymousRoute[] = [
  { path: '/login' },
  { path: '/mcp' },
  { path: '/invite/[token]' },
  { path: '/reset/[token]' },
  { path: '/embed/public/[token]', embeddable: true },
  { path: '/embed/query/[queryId]/visualization/[vizId]', embeddable: true },
  { path: '/dashboards/public/[token]', embeddable: true },
  { path: '/reports/public/[token]', embeddable: true },
]

function declaredAndAllowed(registry: Registry): AnonymousRoute[] {
  return Object.keys(registry)
    .sort()
    .flatMap((key) => registry[key].anonymousRoutes ?? [])
    .filter((route) => aFeatureMayDeclareThisAnonymous(route.path))
}

export function anonymousFeaturePaths(registry: Registry = FEATURES): string[] {
  return declaredAndAllowed(registry).map((route) => route.path)
}

export function embeddableFeaturePaths(registry: Registry = FEATURES): string[] {
  return declaredAndAllowed(registry)
    .filter((route) => route.embeddable === true)
    .map((route) => route.path)
}

export function isAnonymousFeaturePath(pathname: string, registry: Registry = FEATURES): boolean {
  return anonymousFeaturePaths(registry).some((pattern) => matchesRoutePattern(pathname, pattern))
}

export function isEmbeddableFeaturePath(pathname: string, registry: Registry = FEATURES): boolean {
  return embeddableFeaturePaths(registry).some((pattern) => matchesRoutePattern(pathname, pattern))
}

export function isAnonymousPath(pathname: string, registry: Registry = FEATURES): boolean {
  return (
    COMMUNITY_ANONYMOUS_ROUTES.some((route) => matchesRoutePattern(pathname, route.path)) ||
    isAnonymousFeaturePath(pathname, registry)
  )
}

export function isEmbeddablePath(pathname: string, registry: Registry = FEATURES): boolean {
  return (
    COMMUNITY_ANONYMOUS_ROUTES.some(
      (route) => route.embeddable === true && matchesRoutePattern(pathname, route.path)
    ) || isEmbeddableFeaturePath(pathname, registry)
  )
}

export function undeclarableAnonymousPaths(registry: Registry = FEATURES): string[] {
  return Object.keys(registry)
    .sort()
    .flatMap((key) => registry[key].anonymousRoutes ?? [])
    .map((route) => route.path)
    .filter((path) => !aFeatureMayDeclareThisAnonymous(path))
}

function sharesUrlSpace(a: string[], b: string[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (segment, index) =>
        isDynamicSegment(segment) || isDynamicSegment(b[index]) || segment === b[index]
    )
  )
}

function isSelectedOver(a: string[], b: string[]): boolean {
  for (let index = 0; index < a.length; index += 1) {
    if (isDynamicSegment(a[index]) !== isDynamicSegment(b[index])) return !isDynamicSegment(a[index])
  }
  return true
}

export interface AnonymousRouteCollision {
  path: string
  servedBy: string[]
}

export function anonymousRouteCollisions(
  manifest: readonly string[],
  registry: Registry = FEATURES
): AnonymousRouteCollision[] {
  const declared = anonymousFeaturePaths(registry)
  const declaredPaths = new Set(declared)
  const manifestPaths = new Set(manifest)

  return declared.flatMap((path) => {
    const segments = routePatternSegments(path)
    if (segments === null) return []

    const overlapping = manifest
      .filter((route) => route !== path && !declaredPaths.has(route))
      .filter((route) => {
        const other = routePatternSegments(route)
        return other !== null && sharesUrlSpace(other, segments)
      })
      .slice()
      .sort()
    const shadowing = overlapping.filter((route) =>
      isSelectedOver(routePatternSegments(route) as string[], segments)
    )

    if (manifestPaths.has(path) && shadowing.length === 0) return []
    return [{ path, servedBy: overlapping }]
  })
}
