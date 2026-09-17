import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { anonymousRouteCollisions } from '@/features/anonymous-routes'
import type { FeatureDescriptor } from '@/features/types'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '../app')

const ROUTE_FILES = new Set(['page.tsx', 'page.ts', 'route.ts', 'route.tsx'])

function isRoutableDirectory(name: string): boolean {
  return !name.startsWith('_') && !name.startsWith('@') && !name.startsWith('(')
}

function routeManifest(dir = APP_DIR, prefix = ''): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const here = entries.some((entry) => entry.isFile() && ROUTE_FILES.has(entry.name))
    ? [prefix === '' ? '/' : prefix]
    : []

  return entries
    .filter((entry) => entry.isDirectory() && isRoutableDirectory(entry.name))
    .flatMap((entry) => routeManifest(join(dir, entry.name), `${prefix}/${entry.name}`))
    .concat(here)
    .sort()
}

function registryDeclaring(...paths: { path: string; embeddable?: boolean }[]) {
  return { messages: { id: 'messages', nav: [], routes: [], anonymousRoutes: paths } } satisfies Record<
    string,
    FeatureDescriptor
  >
}

describe('a declaration measured against the routes this app actually serves', () => {
  it('refuses a declared prefix that no route file answers, naming what serves it instead', () => {
    const manifest = ['/messages', '/messages/new', '/messages/[messageId]', '/messages/[messageId]/edit']

    expect(anonymousRouteCollisions(manifest, registryDeclaring({ path: '/messages/public' }))).toEqual([
      { path: '/messages/public', servedBy: ['/messages/[messageId]'] },
    ])
  })

  it.each([
    ['/connect/feeds/public', ['/connect/feeds/[slug]']],
    ['/queries/public', ['/queries/[queryId]']],
    ['/users/public', ['/users/[userId]']],
  ])('refuses %s, which selects an authenticated dynamic route', (path, servedBy) => {
    const manifest = [
      '/connect/feeds',
      '/connect/feeds/[slug]',
      '/connect/feeds/[slug]/edit',
      '/queries/[queryId]',
      '/users/[userId]',
    ]

    expect(anonymousRouteCollisions(manifest, registryDeclaring({ path }))).toEqual([{ path, servedBy }])
  })

  it('refuses a declaration whose shape is legal but which names no route at all', () => {
    const manifest = ['/settings', '/queries/[queryId]']

    expect(
      anonymousRouteCollisions(manifest, registryDeclaring({ path: '/settings/public/deep' }))
    ).toEqual([{ path: '/settings/public/deep', servedBy: [] }])
  })

  it('accepts a declaration that names a route of its own with nothing more specific over it', () => {
    const manifest = ['/messages/[messageId]', '/messages/[messageId]/edit', '/messages/public/[token]']

    expect(
      anonymousRouteCollisions(manifest, registryDeclaring({ path: '/messages/public/[token]' }))
    ).toEqual([])
  })

  it('refuses a declaration a more specific authenticated route sits inside', () => {
    const manifest = ['/service-alerts/public/[slug]', '/service-alerts/public/settings']

    expect(
      anonymousRouteCollisions(manifest, registryDeclaring({ path: '/service-alerts/public/[slug]' }))
    ).toEqual([
      { path: '/service-alerts/public/[slug]', servedBy: ['/service-alerts/public/settings'] },
    ])
  })

  it('accepts that same pair once the more specific route is declared too', () => {
    const manifest = ['/service-alerts/public/[slug]', '/service-alerts/public/settings']
    const registry = registryDeclaring(
      { path: '/service-alerts/public/[slug]' },
      { path: '/service-alerts/public/settings' }
    )

    expect(anonymousRouteCollisions(manifest, registry)).toEqual([])
  })

  it('reads the route files off disk rather than trusting a list', () => {
    const manifest = routeManifest()

    expect(manifest).toContain('/queries/[queryId]')
    expect(manifest).toContain('/dashboards/public/[token]')
    expect(manifest).toContain('/login')
    expect(manifest).not.toContain('/dashboards/public')
  })

  it('finds no collision in the registry this build ships', () => {
    expect(anonymousRouteCollisions(routeManifest())).toEqual([])
  })
})
