import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { THEME_STORAGE_KEY } from '@/lib/theme-preference'

// The empty-feature-registry half of authenticated-layout.test.tsx, split out
// to stay under the file-size limit. Every other case for this component
// lives in the sibling file and runs against the real, populated registry.
let mockPathname = '/queries'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

// featureRouteFor and featureList both take the registry as an explicit
// optional parameter, so this wraps them rather than hand-rolling a fake
// registry shape: the real empty-registry code path runs, in both
// authenticated-layout.tsx (featureRouteFor) and theme-preference.ts's
// forcedTheme (featureList), the same way sidebar-nav.test.ts and
// features/index.test.ts exercise it without mocking @/features wholesale.
let mockEmptyRegistry = true
vi.mock('@/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features')>()
  return {
    ...actual,
    featureRouteFor: (pathname: string) => actual.featureRouteFor(pathname, mockEmptyRegistry ? {} : undefined),
    featureList: () => actual.featureList(mockEmptyRegistry ? {} : undefined),
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

function documentIsDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

// With no reports or wall feature directory installed, featureRouteFor finds
// nothing for print, wall or present, and all three revert to the default
// shell: full chrome, reader's theme preference. An earlier draft of the plan
// this implements asserted that an empty registry also strips chrome and
// forced theme from embed, login, public dashboards and public reports; that
// was false, so the cases below prove those four are unaffected as well as
// proving the three feature-owned rules do revert.
describe('AuthenticatedLayout with an empty feature registry', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-theme')
    mockEmptyRegistry = true
  })

  it('reverts the print route to full chrome and the reader default theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockPathname = '/reports/7/print'
    render(
      <AuthenticatedLayout>
        <div>Print body</div>
      </AuthenticatedLayout>
    )
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(documentIsDark()).toBe(true)
  })

  it('reverts the wall route to full chrome and the reader default theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    mockPathname = '/wall'
    render(
      <AuthenticatedLayout>
        <div>Wall body</div>
      </AuthenticatedLayout>
    )
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(documentIsDark()).toBe(false)
  })

  it('reverts the present route to full chrome and the reader default theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    mockPathname = '/present/5'
    render(
      <AuthenticatedLayout>
        <div>Present body</div>
      </AuthenticatedLayout>
    )
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(documentIsDark()).toBe(false)
  })

  it('still forces an embedded widget light, unaffected by the registry being empty', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockPathname = '/embed/query/3'
    render(
      <AuthenticatedLayout>
        <div>Embed body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(documentIsDark()).toBe(false)
  })

  it('still bypasses the chrome for login, unaffected by the registry being empty', () => {
    mockPathname = '/login'
    render(
      <AuthenticatedLayout>
        <div>Login body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('Login body')).toBeInTheDocument()
  })

  it('still bypasses the chrome for a public dashboard, unaffected by the registry being empty', () => {
    mockPathname = '/dashboards/public/abc'
    render(
      <AuthenticatedLayout>
        <div>Public dashboard body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('Public dashboard body')).toBeInTheDocument()
  })

  it('still bypasses the chrome for a public report link, unaffected by the registry being empty', () => {
    mockPathname = '/reports/public/rpt_abc_123'
    render(
      <AuthenticatedLayout>
        <div>Public report body</div>
      </AuthenticatedLayout>
    )
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('Public report body')).toBeInTheDocument()
  })
})
