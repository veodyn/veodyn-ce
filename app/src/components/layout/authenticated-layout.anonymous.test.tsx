import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { FeatureDescriptor } from '@/features/types'

let mockPathname = '/queries'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

let registry: Record<string, FeatureDescriptor> = {}
vi.mock('@/features/generated-registry', () => ({
  get FEATURES() {
    return registry
  },
}))
vi.mock('@/components/auth/session-provider', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="session-provider">{children}</div>
  ),
}))
vi.mock('@/components/layout/app-sidebar', () => ({
  AppSidebar: () => <nav data-testid="app-sidebar" />,
}))
vi.mock('@/components/shared/offline-banner', () => ({ OfflineBanner: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/search/command-palette-provider', () => ({ CommandPaletteProvider: () => null }))

import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

const DECLARING: Record<string, FeatureDescriptor> = {
  messages: {
    id: 'messages',
    nav: [],
    routes: [],
    anonymousRoutes: [
      { path: '/service-alerts/public/[slug]' },
      { path: '/service-alerts/public/[slug]/banner', embeddable: true },
      { path: '/messages/public/[token]' },
    ],
  },
}

const DECLARING_WHAT_IT_MAY_NOT: Record<string, FeatureDescriptor> = {
  rogue: { id: 'rogue', nav: [], routes: [], anonymousRoutes: [{ path: '/admin' }] },
}

function renderAt(pathname: string) {
  mockPathname = pathname
  render(
    <AuthenticatedLayout>
      <div>Body</div>
    </AuthenticatedLayout>
  )
}

describe('AuthenticatedLayout and a feature-declared session-less route', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    registry = {}
  })

  it.each([
    '/service-alerts/public/agency-one',
    '/service-alerts/public/agency-one/banner',
    '/messages/public/msg_abc',
  ])('renders %s outside SessionProvider, because there is no session to provide', (pathname) => {
    registry = DECLARING
    renderAt(pathname)

    expect(screen.queryByTestId('session-provider')).not.toBeInTheDocument()
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it.each([
    '/messages',
    '/messages/msg_abc',
    '/messages/public',
    '/messages/publicity',
    '/service-alerts',
    '/service-alerts/public',
  ])('keeps %s inside SessionProvider with the full shell', (pathname) => {
    registry = DECLARING
    renderAt(pathname)

    expect(screen.getByTestId('session-provider')).toBeInTheDocument()
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
  })

  it('keeps the shell on a path a package declared but may not declare', () => {
    registry = DECLARING_WHAT_IT_MAY_NOT
    renderAt('/admin/status')

    expect(screen.getByTestId('session-provider')).toBeInTheDocument()
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
  })

  it.each(['/login', '/embed/public/abc', '/dashboards/public/abc', '/reports/public/abc', '/invite/tok'])(
    'still bypasses the shell for %s with no declaration involved',
    (pathname) => {
      registry = {}
      renderAt(pathname)

      expect(screen.queryByTestId('session-provider')).not.toBeInTheDocument()
      expect(screen.getByText('Body')).toBeInTheDocument()
    }
  )
})
