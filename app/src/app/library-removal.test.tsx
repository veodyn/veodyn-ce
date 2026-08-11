// A way to remove the thing, on every community library page at once.
//
// An author could create five kinds of content here and take back two and a
// half of them: dashboards and reports had no removal anywhere, and the query
// archive was buried on a detail page. Every one of those was invisible from
// inside the page that lacked it, because a missing control has no test of its
// own to fail. This suite is the one that fails, and it fails for the SIXTH
// library type too, on the day someone adds one and wires everything but this.
//
// THREE pages here, not five. /kpis and /reports are feature routes and their
// halves of this suite are src/app/kpis/library-conventions.test.tsx and
// src/app/reports/library-conventions.test.tsx, which make the same two
// assertions. The sixth-library-type guard therefore covers the community
// pages, and each feature page covers itself.
//
// It also pins the verb, not just the presence of a menu. The two backends
// disagree about what removal means (Redash archives queries and dashboards
// recoverably, veodyn-api and Redash delete the other three outright), and the
// whole point of lib/removal.ts is that a page cannot quietly promise the wrong
// one. A page that shipped "Delete" over an archive would pass a presence
// check and lie to the person clicking it.
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
// and resetStores() leaves currentUser null. An admin, which is what mock mode
// signs you in as, so this asks "did any page forget to wire removal at all".
// It deliberately does NOT carry the ownership matrix: owner vs non-owner vs
// non-owning admin is asserted per page, against each backend's own rule.
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
    // against an empty skeleton. A page that renders no rows at all cannot
    // satisfy this, which is the failure mode a queryBy-based version of this
    // test would have passed straight through.
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

      // What this proves, precisely: that the page passed removalCopy its OWN
      // kind. Every page labels its item `copy.verb`, so this cannot catch
      // removal.ts being wrong about a verb (removal.test.ts asserts those
      // against literals). It catches the copy-paste error that actually
      // happens when the fourth page is written from the third: /dashboards
      // asking for 'kpi' renders "Delete" over a recoverable archive, and fails
      // here. Verified by mutation, both ways round.
      expect(within(menu).getByRole('menuitem', { name: verb })).toBeInTheDocument()
    }
  )
})
