import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { THEME_STORAGE_KEY } from '@/lib/theme-preference'
import type { FeatureDescriptor } from '@/features'

let mockPathname = '/queries'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

// Two synthetic descriptors, so the feature-route cases below prove the
// MECHANISM (a route a descriptor claims gets the bare shell and the theme it
// declares, and a path no rule claims keeps the chrome) rather than which
// surfaces a build happens to install. `alpha` is a whole dark surface,
// `beta` one ink-on-paper leaf route, which are the two shapes real
// descriptors use. Both helpers take the registry as an explicit optional
// parameter, so this wraps them rather than hand-rolling a registry shape: the
// real lookup runs, in authenticated-layout.tsx (featureRouteFor) and in
// theme-preference.ts's forcedTheme (featureList) alike. A build that installs
// a feature asserts its own routes in its own suite.
const mockRegistry: Record<string, FeatureDescriptor> = {
  alpha: {
    id: 'alpha',
    nav: [],
    routes: [{ pattern: /^\/alpha(\/|$)/, bareChrome: true, forcedTheme: 'dark' }],
  },
  beta: {
    id: 'beta',
    nav: [],
    routes: [
      { pattern: /^\/beta\/[^/]+\/paper\/?$/, bareChrome: true, forcedTheme: 'light' },
    ],
  },
}
vi.mock('@/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features')>()
  return {
    ...actual,
    featureRouteFor: (pathname: string) => actual.featureRouteFor(pathname, mockRegistry),
    featureList: () => actual.featureList(mockRegistry),
  }
})
vi.mock('@/components/auth/session-provider', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="session-provider">{children}</div>
  ),
}))
vi.mock('@/components/layout/app-sidebar', () => ({
  AppSidebar: () => <nav data-testid="app-sidebar" />,
}))
vi.mock('@/components/shared/offline-banner', () => ({
  OfflineBanner: () => null,
}))
vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => null,
}))
vi.mock('@/components/search/command-palette-provider', () => ({
  CommandPaletteProvider: () => null,
}))

import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

// The empty-feature-registry cases live in authenticated-layout.registry.test.tsx,
// which mocks @/features the same way to exercise the real empty-registry code
// path. The cases in this file run against the synthetic registry above, and
// the hardcoded branches (embed, login, public dashboards, public reports)
// against the component's own prefixes, which no registry feeds.
describe('AuthenticatedLayout', () => {
  // <html> is shared by every case in this file, and the theme is applied to it
  // rather than to the render container, so a leftover class from the previous
  // case would make the next one pass for the wrong reason.
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders the sidebar chrome for an app route', () => {
    mockPathname = '/queries'
    render(
      <AuthenticatedLayout>
        <div>Page body</div>
      </AuthenticatedLayout>
    )
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByText('Page body')).toBeInTheDocument()
  })

  it('bypasses the chrome for embed routes', () => {
    mockPathname = '/embed/abc'
    render(
      <AuthenticatedLayout>
        <div>Embed body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('Embed body')).toBeInTheDocument()
  })

  it('bypasses the chrome for a public report link', () => {
    mockPathname = '/reports/public/rpt_abc_123'
    render(
      <AuthenticatedLayout>
        <div>Public report body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('Public report body')).toBeInTheDocument()
  })

  it('keeps the chrome on the authenticated report routes', () => {
    // The public branch is bounded to the /reports/public/ segment, and it is
    // hardcoded rather than registry-fed precisely so it keeps working with no
    // reports package installed: a report whose slug merely starts with
    // "public" is still an analyst route with chrome.
    for (const pathname of ['/reports', '/reports/quarterly-review', '/reports/publications']) {
      mockPathname = pathname
      const { unmount } = render(
        <AuthenticatedLayout>
          <div>Report body</div>
        </AuthenticatedLayout>
      )
      expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
      unmount()
    }
  })

  it('renders a chrome-free but still authenticated shell for a route that asks for it', () => {
    // A route a descriptor marks bareChrome carries no sidebar, so the printed
    // page holds only the content, but unlike the public link it stays behind
    // SessionProvider.
    mockPathname = '/beta/quarterly-review/paper'
    render(
      <AuthenticatedLayout>
        <div>Print body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByTestId('session-provider')).toBeInTheDocument()
    expect(screen.getByText('Print body')).toBeInTheDocument()
  })

  it('keeps the chrome on paths the route patterns exclude', () => {
    // The patterns are exact RegExps rather than prefixes, so a parent path and
    // a deeper one do not inherit a leaf route's bare shell.
    for (const pathname of ['/beta/quarterly-review', '/beta/paper', '/beta/a/paper/b']) {
      mockPathname = pathname
      const { unmount } = render(
        <AuthenticatedLayout>
          <div>Report body</div>
        </AuthenticatedLayout>
      )
      expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
      unmount()
    }
  })

  // These read <html> rather than the render container. The scope used to live
  // on a display:contents wrapper inside the tree, which left every portalled
  // surface (dialog, popover, tooltip, dropdown) resolving light tokens on a
  // dark page, because portals render into document.body and CSS inheritance
  // follows the DOM rather than the React tree.
  function documentIsDark(): boolean {
    return document.documentElement.classList.contains('dark')
  }

  it('renders a dark, sidebar-free shell for a route that declares one', () => {
    mockPathname = '/alpha'
    render(
      <AuthenticatedLayout>
        <div>Wall body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('Wall body')).toBeInTheDocument()
    expect(documentIsDark()).toBe(true)
  })

  it('leaves a normal app route on the reader default, which is light here', () => {
    mockPathname = '/queries'
    render(
      <AuthenticatedLayout>
        <div>Page body</div>
      </AuthenticatedLayout>
    )
    expect(documentIsDark()).toBe(false)
  })

  // A surface whose theme is a property of the surface is not the reader's to
  // choose, so a stored preference must not reach it. Both directions, since
  // the two forced themes fail differently: a dark page sent to a printer and
  // a white flash on a wall display.
  it('keeps a forced-dark route dark for a reader who prefers light', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    mockPathname = '/alpha/5'
    render(
      <AuthenticatedLayout>
        <div>Wall body</div>
      </AuthenticatedLayout>
    )
    expect(documentIsDark()).toBe(true)
  })

  it('keeps a forced-light route light for a reader who prefers dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockPathname = '/beta/7/paper'
    render(
      <AuthenticatedLayout>
        <div>Print body</div>
      </AuthenticatedLayout>
    )
    expect(documentIsDark()).toBe(false)
  })

  it('keeps an embedded widget light for a reader who prefers dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockPathname = '/embed/query/3'
    render(
      <AuthenticatedLayout>
        <div>Embed body</div>
      </AuthenticatedLayout>
    )
    expect(documentIsDark()).toBe(false)
  })

  it('applies a stored dark preference to an ordinary route', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockPathname = '/queries'
    render(
      <AuthenticatedLayout>
        <div>Page body</div>
      </AuthenticatedLayout>
    )
    expect(documentIsDark()).toBe(true)
  })
})
