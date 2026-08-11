// The Create-with-AI entry point, on every community library page at once.
//
// Two things are easy to get wrong here and invisible everywhere else: a page
// that forgets the button, and a page that mounts it with the wrong `kind`
// (copy-paste being how the second and third page get written). The kind is not
// readable from the header, so it is read from the dialog the button opens:
// every kind has its own title, so a KPI page wired to `kind="query"` fails
// here rather than in production.
//
// AI off has to be checked on the same pages, because "renders null" is only
// half the promise: the manual button has to still be there, in the position it
// has always been in.
//
// THREE pages here, not five. /kpis and /reports are feature routes and their
// halves of this suite are src/app/kpis/library-conventions.test.tsx and
// src/app/reports/library-conventions.test.tsx, which make the same two
// assertions against the same table shape. The "a page that forgets" guard
// therefore covers the community library pages and each feature page covers
// itself, which is the most a community tree can say about a route it does not
// contain.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardsPage from './dashboards/page'
import QueriesPage from './queries/page'
// The client body, not the route: the route is a server component that gates
// on instance config, and this suite is about what a library page offers once
// it renders.
import { QuerySnippetsPage } from './query-snippets/query-snippets-page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

interface LibraryPage {
  label: string
  Page: ComponentType
  /** The manual button that was there before this feature, and still is. */
  manual: RegExp
  /** The dialog title that proves which `kind` this page passed. */
  chatTitle: string
}

const LIBRARY_PAGES: LibraryPage[] = [
  { label: '/queries', Page: QueriesPage, manual: /new query/i, chatTitle: 'Create a query with AI' },
  {
    label: '/dashboards',
    Page: DashboardsPage,
    manual: /new dashboard/i,
    chatTitle: 'Create a dashboard with AI',
  },
  {
    label: '/query-snippets',
    Page: QuerySnippetsPage,
    manual: /new snippet/i,
    chatTitle: 'Create a snippet with AI',
  },
]

function renderPage(Page: ComponentType, aiEnabled: boolean) {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: aiEnabled } }}>
      <Page />
    </ConfigProvider>
  )
}

afterEach(() => resetStores())

describe('the Create-with-AI entry point on the library pages', () => {
  it.each(LIBRARY_PAGES)(
    '$label offers no AI affordance at all when AI is off, and keeps its manual button',
    async ({ Page, manual }) => {
      renderPage(Page, false)

      // The positive half first. Without it, an absence assertion passes on a
      // page that failed to render at all, which is the trap this repo keeps
      // walking into.
      expect(await screen.findByRole('button', { name: manual })).toBeInTheDocument()

      // Not a disabled button and not a tooltip: AI off means the door is not
      // there (spec section 2).
      expect(screen.queryByRole('button', { name: 'Create with AI' })).not.toBeInTheDocument()
      expect(screen.queryByText(/create with ai/i)).not.toBeInTheDocument()
    }
  )

  it.each(LIBRARY_PAGES)(
    '$label puts Create with AI before its manual button and opens the chat for its own kind',
    async ({ Page, manual, chatTitle }) => {
      const user = userEvent.setup()
      renderPage(Page, true)

      const manualButton = await screen.findByRole('button', { name: manual })
      const aiButton = screen.getByRole('button', { name: 'Create with AI' })

      // To the LEFT of the primary, so the button users already reach for has
      // not moved (spec section 3). DOM order, not a class name: the header is
      // a plain flex row, so the first child is the left-hand one.
      expect(aiButton.compareDocumentPosition(manualButton)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )

      await user.click(aiButton)
      expect(await screen.findByRole('dialog')).toHaveAccessibleName(chatTitle)
    }
  )
})
