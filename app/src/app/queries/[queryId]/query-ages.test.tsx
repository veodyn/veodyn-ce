// A results page shows more than one age, and each has to say what it measures.
//
// Before this, the header read "Updated 10 hours ago" above a results table and
// meant the query OBJECT's edit time. Saving a refresh schedule, which changes
// no data whatsoever, flipped it to "just now" while every value in the table
// stayed byte-identical, and /schedules reported a third number for the same
// query under the name "Last Result".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueryViewPage from '@/app/queries/[queryId]/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const QUERY_ID = 4242
const EDITED_AT = '2026-07-31T12:00:00Z'
const RETRIEVED_AT = '2026-07-25T12:00:00Z'

function seedQuery(overrides: Partial<MockQuery> = {}) {
  const query: MockQuery = {
    ...mockQueries[0],
    id: QUERY_ID,
    name: 'Platform Dwell Time',
    updated_at: EDITED_AT,
    retrieved_at: RETRIEVED_AT,
    latest_query_data_id: null,
    schedule: null,
    tags: [],
    ...overrides,
  }
  useMockDataStore.setState({ queries: [query] })
}

async function renderPage() {
  await act(async () => {
    renderWithProviders(<QueryViewPage params={Promise.resolve({ queryId: String(QUERY_ID) })} />)
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

describe('the ages on a query detail page', () => {
  it('names both of them, so neither can be read as the other', async () => {
    seedQuery()
    await renderPage()

    expect(await screen.findByText(/Last result/)).toBeVisible()
    expect(screen.getByText(/Query edited/)).toBeVisible()
    // The unlabelled word is what made the two indistinguishable.
    expect(screen.queryByText(/^Updated/)).toBeNull()
  })

  it('reports the result age from the same field /schedules calls Last Result', async () => {
    // Six days apart, so a page reading the wrong field cannot pass by
    // coincidence: the two would have to render the same relative phrase.
    seedQuery()
    await renderPage()

    const lastResult = (await screen.findByText(/Last result/)).textContent ?? ''
    const edited = screen.getByText(/Query edited/).textContent ?? ''
    expect(lastResult).not.toEqual(edited)
    expect(lastResult).toMatch(/days? ago/)
  })

  it('says nothing about a result for a query that has never run', async () => {
    // Rather than "Last result never", which reads as a fact about the data.
    //
    // The cast is the point rather than a workaround: `RedashQuery.retrieved_at`
    // is `string | null` and `MockQuery` declares it always present, so the
    // fixtures cannot produce the state a real backend can. This pins the page
    // against the contract Redash actually has.
    seedQuery({ retrieved_at: null as unknown as string })
    await renderPage()

    expect(await screen.findByText(/Query edited/)).toBeVisible()
    expect(screen.queryByText(/Last result/)).toBeNull()
  })
})
