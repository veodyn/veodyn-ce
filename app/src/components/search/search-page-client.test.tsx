import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseQueryResult } from '@tanstack/react-query'
import { SearchPageClient } from './search-page-client'
import { useFederatedSearch } from '@/hooks/use-federated-search'
import { RECENTS_KEY } from '@/hooks/use-recent-searches'
import type { SearchResultItem } from '@/services/search/types'

vi.mock('@/hooks/use-federated-search', () => ({ useFederatedSearch: vi.fn() }))

const mockHook = vi.mocked(useFederatedSearch)

function state(over: Partial<UseQueryResult<SearchResultItem[]>>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as UseQueryResult<SearchResultItem[]>
}

const results: SearchResultItem[] = [
  { id: 'query-1', type: 'query', title: 'Rail Ridership', href: '/queries/1' },
  { id: 'dashboard-2', type: 'dashboard', title: 'Rail Overview', href: '/dashboards/2' },
]

beforeEach(() => {
  mockHook.mockReset()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/search')
})

describe('SearchPageClient', () => {
  it('puts the cursor in the search box, so typing on arrival goes somewhere', async () => {
    // Navigating to /search and typing produced nothing: document.activeElement
    // was BODY and the keystrokes went to the page. This route is one text
    // field and a list of what it matches, so the field is the page. The
    // component already took focus back on Escape, on clear, and on removing a
    // recent search; the moment it did not was the one a user meets first.
    mockHook.mockReturnValue(state({}))
    render(<SearchPageClient initialQuery="" initialTab="all" />)

    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveFocus())
  })

  it('shows the recents block when the query is empty', () => {
    mockHook.mockReturnValue(state({}))
    render(<SearchPageClient initialQuery="" initialTab="all" />)
    expect(
      screen.getByText('Search across queries, dashboards, datasets, KPIs and reports.')
    ).toBeInTheDocument()
  })

  it('renders skeletons while loading rather than collapsing the list', () => {
    mockHook.mockReturnValue(state({ isLoading: true }))
    const { container } = render(<SearchPageClient initialQuery="rail" initialTab="all" />)
    expect(screen.getByRole('status')).toHaveTextContent('Searching…')
    // motion-safe: so the pulse is suppressed under prefers-reduced-motion.
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0)
  })

  it('renders an error with a working retry', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockHook.mockReturnValue(state({ isError: true, refetch }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)

    expect(screen.getByText('Search failed. Try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refetch).toHaveBeenCalled()
  })

  it('renders NoData when a settled search returns nothing', () => {
    mockHook.mockReturnValue(state({ data: [] }))
    render(<SearchPageClient initialQuery="zzz" initialTab="all" />)
    expect(screen.getByText('No results for "zzz".')).toBeInTheDocument()
  })

  it('names the type in the empty state of a type tab', () => {
    mockHook.mockReturnValue(state({ data: [] }))
    render(<SearchPageClient initialQuery="zzz" initialTab="dashboard" />)
    expect(screen.getByText('No dashboards match "zzz".')).toBeInTheDocument()
  })

  it('filters results down to the active type tab', () => {
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="dashboard" />)

    expect(screen.getByRole('link', { name: /Rail Overview/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Rail Ridership/ })).not.toBeInTheDocument()
  })

  it('shows counts on the tabs once the search settles', () => {
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)
    expect(screen.getByRole('link', { name: /^All\s+2$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Queries\s+1$/ })).toBeInTheDocument()
  })

  it('syncs the settled query into the URL without a history entry', async () => {
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)
    await waitFor(() => expect(window.location.search).toBe('?q=rail'))
  })

  it('clears the query on Escape', async () => {
    const user = userEvent.setup()
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)

    const input = screen.getByRole('searchbox', { name: 'Search' })
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('')
  })

  it('moves focus from the input to the first row on ArrowDown', async () => {
    const user = userEvent.setup()
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)

    await user.click(screen.getByRole('searchbox', { name: 'Search' }))
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('link', { name: /Rail Ridership/ })).toHaveFocus()
  })

  it('returns focus to the input on ArrowUp from the first row', async () => {
    const user = userEvent.setup()
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)

    await user.click(screen.getByRole('searchbox', { name: 'Search' }))
    await user.keyboard('{ArrowDown}{ArrowUp}')

    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveFocus()
  })

  it('adopts a new initialQuery when the shell stays mounted', async () => {
    mockHook.mockReturnValue(state({ data: results }))
    const { rerender } = render(<SearchPageClient initialQuery="" initialTab="all" />)
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('')

    // A recent-search link or back/forward is a same-route navigation: the
    // server component re-renders but this client shell is preserved.
    rerender(<SearchPageClient initialQuery="bike" initialTab="all" />)

    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('bike')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Rail Ridership/ })).toBeInTheDocument()
    )
  })

  it('announces the settled result count in a persistent live region', async () => {
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2 results for "rail"')
    )
  })

  it('announces a failure in the live region', () => {
    mockHook.mockReturnValue(state({ isError: true }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)
    expect(screen.getByRole('status')).toHaveTextContent('Search failed.')
  })

  it('returns focus to the input after the clear button removes itself', async () => {
    const user = userEvent.setup()
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveFocus()
  })

  it('renders results as a list so their count and position are exposed', () => {
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="query" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('records a settled non-empty search in recents', async () => {
    mockHook.mockReturnValue(state({ data: results }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]')).toContain('rail')
    })
  })

  it('does not record a failed search', async () => {
    mockHook.mockReturnValue(state({ isError: true }))
    render(<SearchPageClient initialQuery="rail" initialTab="all" />)

    await waitFor(() => expect(screen.getByText('Search failed. Try again.')).toBeInTheDocument())
    expect(window.localStorage.getItem(RECENTS_KEY)).toBeNull()
  })
})
