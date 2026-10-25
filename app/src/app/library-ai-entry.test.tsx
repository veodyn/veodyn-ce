// The Create-with-AI entry point, on every community library page at once.
//
// Two failures are invisible elsewhere: a page that forgets the button, and one
// that mounts it with the wrong `kind`. The kind is not readable from the
// header, so it is read from the dialog title the button opens.
//
// AI off is checked on the same pages, because "renders null" is only half the
// promise: the manual button has to still be there, in its usual position.
//
// THREE pages here, not five. /kpis and /reports are feature routes and their
// halves of this suite are src/app/kpis/library-conventions.test.tsx and
// src/app/reports/library-conventions.test.tsx, which make the same two
// assertions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardsPage from './dashboards/page'
import QueriesPage from './queries/page'
// The client body, not the route: the route is a server component gated on
// instance config.
import { QuerySnippetsPage } from './query-snippets/query-snippets-page'

vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')

const createThread = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  createThread,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

interface LibraryPage {
  label: string
  Page: ComponentType
  /** The manual button that was there before this feature, and still is. */
  manual: RegExp
  newKind: 'query' | 'dashboard' | 'snippet'
}

const LIBRARY_PAGES: LibraryPage[] = [
  { label: '/queries', Page: QueriesPage, manual: /new query/i, newKind: 'query' },
  {
    label: '/dashboards',
    Page: DashboardsPage,
    manual: /new dashboard/i,
    newKind: 'dashboard',
  },
  {
    label: '/query-snippets',
    Page: QuerySnippetsPage,
    manual: /new snippet/i,
    newKind: 'snippet',
  },
]

function renderPage(Page: ComponentType, aiEnabled: boolean) {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: aiEnabled } }}>
      <Page />
    </ConfigProvider>
  )
}

beforeEach(() => createThread.mockResolvedValue({ id: 'new-thread' }))

afterEach(() => resetStores())

describe('the Create-with-AI entry point on the library pages', () => {
  it.each(LIBRARY_PAGES)(
    '$label offers no AI affordance at all when AI is off, and keeps its manual button',
    async ({ Page, manual }) => {
      renderPage(Page, false)

      // The positive half first: without it, the absence assertions below pass
      // on a page that failed to render at all.
      expect(await screen.findByRole('button', { name: manual })).toBeInTheDocument()

      // Not a disabled button and not a tooltip: AI off means the door is not
      // there (spec section 2).
      expect(screen.queryByRole('button', { name: 'Create with AI' })).not.toBeInTheDocument()
      expect(screen.queryByText(/create with ai/i)).not.toBeInTheDocument()
    }
  )

  it.each(LIBRARY_PAGES)(
    '$label puts Create with AI before its manual button and starts a chat about a new object of its own kind',
    async ({ Page, manual, newKind }) => {
      const user = userEvent.setup()
      renderPage(Page, true)

      const manualButton = await screen.findByRole('button', { name: manual })
      const aiButton = screen.getByRole('button', { name: 'Create with AI' })

      // To the LEFT of the primary (spec section 3). DOM order, not a class
      // name: the header is a plain flex row, so first child is left-hand.
      expect(aiButton.compareDocumentPosition(manualButton)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )

      await user.click(aiButton)
      await waitFor(() =>
        expect(createThread).toHaveBeenCalledWith({ kind: 'new', newKind }, expect.any(AbortSignal))
      )
    }
  )
})
