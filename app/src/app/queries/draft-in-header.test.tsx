import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueryViewPage from '@/app/queries/[queryId]/page'

// QuerySourceMenu calls useRouter at the top of its render, and there is no App
// Router mounted under a component test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const QUERY_ID = 4243

// `features` is one object, so a partial override replaces the whole of it and
// every key it holds has to be named.
function features(queryDrafts: boolean) {
  return { config: { features: { query_snippets: false, query_drafts: queryDrafts } } }
}

function seedQuery(overrides: Partial<MockQuery>) {
  const query: MockQuery = {
    ...mockQueries[0],
    id: QUERY_ID,
    name: 'Platform Dwell Time',
    can_edit: true,
    latest_query_data_id: null,
    schedule: null,
    ...overrides,
  }
  useMockDataStore.setState({ queries: [query] })
}

async function renderPage(queryDrafts = true) {
  await act(async () => {
    renderWithProviders(
      <QueryViewPage params={Promise.resolve({ queryId: String(QUERY_ID) })} />,
      features(queryDrafts)
    )
  })
}

beforeEach(() => {
  resetStores()
  useAuthStore.setState({ isAuthenticated: true, isLoading: false })
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

// The view page is where a reader lands, so it is where "this is not in anyone
// else's list yet" has to be legible. The editor header carries the same badge
// for the author.
describe('the draft badge in the query view header', () => {
  it('marks a draft query beside its title', async () => {
    seedQuery({ is_draft: true })
    await renderPage()

    expect(await screen.findByText('Draft')).toBeInTheDocument()
  })

  it('spells out that a draft is unlisted rather than private', async () => {
    seedQuery({ is_draft: true })
    await renderPage()

    // The caveat is the point of the badge: "draft" reads as "private" and it
    // is not. It has to reach a screen reader and not only a pointer hovering a
    // title attribute, and it must say both halves, since the listing moved but
    // the read path still gates on data source access alone.
    expect(await screen.findByText(/listed only for you/i)).toBeInTheDocument()
    expect(screen.getByText(/not a permission/i)).toBeInTheDocument()
  })

  it('leaves a shared query unmarked', async () => {
    seedQuery({ is_draft: false })
    await renderPage()

    // The header itself rendered, so the absence below is a real absence.
    expect(await screen.findByText('Platform Dwell Time')).toBeInTheDocument()
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })

  it('says nothing about drafts with the workflow off', async () => {
    // Same seed as the first test. Only the flag differs, so a badge wired to
    // is_draft alone passes that one and fails this one.
    seedQuery({ is_draft: true })
    await renderPage(false)

    expect(await screen.findByText('Platform Dwell Time')).toBeInTheDocument()
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
    expect(screen.queryByText(/listed only for you/i)).not.toBeInTheDocument()
  })
})
