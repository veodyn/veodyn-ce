// The page exists to answer one question an operator cannot answer from logs:
// did this image actually register what it was built with? So the assertions
// are about what the registry says, not about layout.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import {
  PLUGIN_API_VERSION,
  registerVisualization,
  type VisualizationPlugin,
} from '@/lib/visualizations'
import AdminPluginsPage from './page'

function signInAsAdmin() {
  const permissions = ['admin' as const]
  const admin = {
    id: 1,
    name: 'Root',
    email: 'root@example.test',
    profile_image_url: '',
    groups: [1],
    api_key: 'root-key',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-01-01T00:00:00Z',
    is_email_verified: true,
    auth_type: 'password',
    permissions,
    isAdmin: true,
    hasPermission: (permission: string) => permissions.includes(permission as 'admin'),
    canEdit: () => true,
    canCreate: () => true,
  } satisfies CurrentUser
  useAuthStore.setState({ currentUser: admin })
}

function fakePlugin(type: string, over: Partial<VisualizationPlugin> = {}): VisualizationPlugin {
  return {
    apiVersion: PLUGIN_API_VERSION,
    type,
    displayName: type,
    icon: () => null,
    defaultOptions: {},
    Renderer: () => null,
    ...over,
  }
}

function renderPage(visualizations: { enabled?: string[] | null; audience?: Record<string, 'analyst' | 'internal'> } = {}) {
  signInAsAdmin()
  renderWithProviders(<AdminPluginsPage />, {
    config: {
      visualizations: {
        enabled: visualizations.enabled ?? null,
        audience: visualizations.audience ?? {},
      },
    },
  })
}

afterEach(() => resetStores())

// Runs before anything registers, which is the only way to see the state the
// stock OSS build is actually in.
describe('with no plugins installed', () => {
  it('says so, and names what this build could install', () => {
    renderPage()
    expect(screen.getByText(/No plugin visualizations are registered/)).toBeInTheDocument()
    expect(screen.getByText('NEXT_PUBLIC_VEODYN_PLUGINS')).toBeInTheDocument()
    // The page renders `Object.keys(PLUGIN_PACKAGES).join(', ')`, so the exact
    // string is a property of the BUILD, not of this component. An overlay
    // build carries its own package directories and renders a longer list in
    // that same element, which an equality match reads as the page having
    // stopped naming what the build can install.
    //
    // src/plugins/index.test.ts was relaxed from an exact list to
    // `toContain('example')` for this reason and its comment says so. This
    // assertion was missed then, because nothing rendered this page with a
    // tenant package in the registry until a three-way composed build existed
    // to do it. The claim kept is the one the file header states: the page
    // answers what this image registered.
    expect(screen.getByText(/(^|, )example(,|$)/)).toBeInTheDocument()
  })

  it('counts the core types rather than listing them, since they are not plugins', () => {
    renderPage()
    expect(screen.getByText(/15 core types ship with the product/)).toBeInTheDocument()
    expect(screen.queryByText('Table')).not.toBeInTheDocument()
  })
})

describe('with plugins installed', () => {
  beforeAll(() => {
    registerVisualization(fakePlugin('TEST_BOARD', { displayName: 'Board' }))
    registerVisualization(
      fakePlugin('TEST_BACKDROP', { displayName: 'Backdrop', audience: 'internal', needs: 'none' })
    )
  })

  it('names each one as a plugin, with the type an operator would grep for', () => {
    renderPage()
    expect(screen.getByText('Plugin[Board]')).toBeInTheDocument()
    expect(screen.getByText('TEST_BOARD')).toBeInTheDocument()
  })

  it('reports what a type reads, so a data-free one is not mistaken for a broken one', () => {
    renderPage()
    expect(screen.getByText('Nothing')).toBeInTheDocument()
    expect(screen.getByText('Its query result')).toBeInTheDocument()
  })

  // The column that earns the page. "Where did my visualization go" has two
  // answers and they need different fixes, so the page distinguishes them
  // rather than saying "Hidden" twice.
  it('separates hidden-because-internal from hidden-because-not-allowlisted', () => {
    renderPage({ enabled: ['TEST_BACKDROP'] })
    expect(screen.getByText('Hidden: internal')).toBeInTheDocument()
    expect(screen.getByText('Hidden: not in visualizations.enabled')).toBeInTheDocument()
  })

  it('shows an analyst type as offered when nothing hides it', () => {
    renderPage()
    expect(screen.getByText('Offered')).toBeInTheDocument()
  })

  // An override is the operator's own doing, and one they will not remember
  // making. Saying who set the audience is the difference between reading the
  // page and re-reading the config.
  it('marks an audience the config set, not the plugin', () => {
    renderPage({ audience: { TEST_BACKDROP: 'analyst' } })
    expect(screen.getByText(/Analysts \(set by config\)/)).toBeInTheDocument()
  })

  it('leaves the core types off the page entirely', () => {
    renderPage()
    expect(screen.queryByText('Plugin[Table]')).not.toBeInTheDocument()
    expect(screen.queryByText('TABLE')).not.toBeInTheDocument()
  })
})
