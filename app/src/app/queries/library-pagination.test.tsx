import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { mockQueries } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueriesPage from '@/app/queries/page'

// Against the real API, which is the only mode where the bug existed: in mock
// mode the hooks always returned the whole array and merely labelled it
// page_size 25, which is exactly why a library capped at 25 rows survived so
// long unnoticed.
vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=all'),
}))

vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: vi.fn(), success: vi.fn() }) }
})

// 120, so the set spans more than one server read (fetchAllPages asks for 100
// at a time) AND more than one rendered page (25 at a time). A fixture of 30
// would have exercised the second and silently passed the first.
const TOTAL = 120

const library = Array.from({ length: TOTAL }, (_, i) => ({
  ...mockQueries[0],
  id: 1000 + i,
  name: `Library query ${String(i + 1).padStart(3, '0')}`,
  is_archived: false,
  is_draft: false,
}))

let requestedPages: number[] = []

function renderQueriesPage(): RenderResult {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: false } }}>
      <QueriesPage />
    </ConfigProvider>
  )
}

beforeEach(() => {
  requestedPages = []
  server.use(
    http.get('/api/node/queries', ({ request }) => {
      const url = new URL(request.url)
      const page = Number(url.searchParams.get('page') ?? 1)
      const pageSize = Number(url.searchParams.get('page_size') ?? 25)
      requestedPages.push(page)
      const start = (page - 1) * pageSize
      return HttpResponse.json({
        count: TOTAL,
        page,
        page_size: pageSize,
        results: library.slice(start, start + pageSize),
      })
    }),
    http.get('/api/node/queries/my', () =>
      HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
    ),
    http.get('/api/node/queries/favorites', () =>
      HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
    ),
    http.get('/api/node/queries/archive', () =>
      HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
    )
  )
})

afterEach(() => resetStores())

describe('queries library pagination', () => {
  // The regression this exists for: the All tab asked for one 25-row server
  // page and rendered it whole, so a 300-query instance showed 25 rows, said
  // "25 queries", and offered no way to reach the 26th.
  it('reads the whole library rather than the first server page', async () => {
    renderQueriesPage()

    expect(await screen.findByText(`${TOTAL} queries`)).toBeInTheDocument()
    // More than one read, which is what distinguishes listAll from list.
    await waitFor(() => expect(requestedPages.length).toBeGreaterThan(1))
  })

  it('shows one page of rows and offers the rest', async () => {
    renderQueriesPage()
    await screen.findByText(`${TOTAL} queries`)

    expect(screen.getByText('Library query 001')).toBeInTheDocument()
    expect(screen.queryByText('Library query 026')).not.toBeInTheDocument()
    // 120 rows at 25 a page.
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument()
  })

  it('reaches a row that used to be unreachable', async () => {
    const user = userEvent.setup()
    renderQueriesPage()
    await screen.findByText(`${TOTAL} queries`)

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.getByText('Library query 026')).toBeInTheDocument()
    expect(screen.queryByText('Library query 001')).not.toBeInTheDocument()
  })

  it('reaches the last row of the library', async () => {
    const user = userEvent.setup()
    renderQueriesPage()
    await screen.findByText(`${TOTAL} queries`)

    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole('button', { name: 'Next page' }))
    }

    expect(screen.getByText(`Library query ${TOTAL}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('sorts across the whole library, not just the page on screen', async () => {
    const user = userEvent.setup()
    renderQueriesPage()
    await screen.findByText(`${TOTAL} queries`)

    // Descending by name puts the highest-numbered query first. If sorting only
    // saw the 25 rows already rendered, it would top out at "Library query 025".
    await user.click(screen.getByRole('button', { name: /name/i }))
    await user.click(screen.getByRole('button', { name: /name/i }))

    expect(screen.getByText(`Library query ${TOTAL}`)).toBeInTheDocument()
  })
})
