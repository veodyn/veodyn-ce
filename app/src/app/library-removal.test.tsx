// A way to remove the thing, on every community library page at once.
//
// THREE pages here, not five. /kpis and /reports are feature routes and their
// halves of this suite are src/app/kpis/library-conventions.test.tsx and
// src/app/reports/library-conventions.test.tsx, which make the same two
// assertions.
//
// It pins the verb, not just the presence of a menu: Redash archives queries
// and dashboards recoverably while the other three are deleted outright, so a
// page shipping "Delete" over an archive would pass a presence check and lie.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { removalCopy, type LibraryKind } from '@/lib/removal'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardsPage from './dashboards/page'
import QueriesPage from './queries/page'
// The client body, not the route: the route is a server component gated on
// instance config. Same reason as library-ai-entry.test.tsx.
import { QuerySnippetsPage } from './query-snippets/query-snippets-page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

interface LibraryPage {
  label: string
  Page: ComponentType
  kind: LibraryKind
}

const LIBRARY_PAGES: LibraryPage[] = [
  { label: '/queries', Page: QueriesPage, kind: 'query' },
  { label: '/dashboards', Page: DashboardsPage, kind: 'dashboard' },
  { label: '/query-snippets', Page: QuerySnippetsPage, kind: 'snippet' },
]

function renderPage(Page: ComponentType) {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: false } }}>
      <Page />
    </ConfigProvider>
  )
}

// Signed in, because three of the five pages gate their menu on the viewer's id
// and resetStores() leaves currentUser null. An admin, so this asks only "did a
// page forget to wire removal at all". The ownership matrix is asserted per
// page, against each backend's own rule.
beforeEach(() => {
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({
      id: 1,
      name: 'Signed in',
      email: 'signed-in@example.com',
      permissions: ['admin', 'view_query'],
    }),
  })
})

afterEach(() => resetStores())

describe('every library list offers a way to remove what it lists', () => {
  it.each(LIBRARY_PAGES)('$label puts a row action menu on its rows', async ({ Page }) => {
    renderPage(Page)

    // findAllBy, so this waits for the list to load rather than asserting
    // against an empty skeleton: a page that renders no rows cannot satisfy it.
    const menus = await screen.findAllByRole('button', { name: /^Actions for / })
    expect(menus.length).toBeGreaterThan(0)
  })

  it.each(LIBRARY_PAGES)(
    '$label names the removal after what its backend actually does',
    async ({ Page, kind }) => {
      const user = userEvent.setup()
      renderPage(Page)

      const [firstMenu] = await screen.findAllByRole('button', { name: /^Actions for / })
      await user.click(firstMenu)

      const menu = await screen.findByRole('menu')
      const { verb } = removalCopy(kind, 'anything')

      // Proves the page passed removalCopy its OWN kind, not that removal.ts
      // has the right verb (removal.test.ts asserts those against literals).
      // Verified by mutation, both ways round.
      expect(within(menu).getByRole('menuitem', { name: verb })).toBeInTheDocument()
    }
  )
})
