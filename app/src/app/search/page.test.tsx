import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SearchPage from '@/app/search/page'

// The page is a server component. The client shell owns hooks and browser
// APIs, none of which are mounted here, so it is stubbed to expose its props.
vi.mock('@/components/search/search-page-client', () => ({
  SearchPageClient: ({
    initialQuery,
    initialTab,
  }: {
    initialQuery: string
    initialTab: string
  }) => <div data-testid="shell" data-query={initialQuery} data-tab={initialTab} />,
}))

async function renderPage(searchParams: Record<string, string | string[]>) {
  render(await SearchPage({ searchParams: Promise.resolve(searchParams) }))
  return screen.getByTestId('shell')
}

describe('SearchPage', () => {
  it('threads q and type from the URL to the shell', async () => {
    const shell = await renderPage({ q: 'bus ridership', type: 'dashboard' })
    expect(shell).toHaveAttribute('data-query', 'bus ridership')
    expect(shell).toHaveAttribute('data-tab', 'dashboard')
  })

  it('defaults to an empty query on the All tab when both params are absent', async () => {
    const shell = await renderPage({})
    expect(shell).toHaveAttribute('data-query', '')
    expect(shell).toHaveAttribute('data-tab', 'all')
  })

  it('normalizes a repeated q param to its first value', async () => {
    const shell = await renderPage({ q: ['bus', 'rail'] })
    expect(shell).toHaveAttribute('data-query', 'bus')
  })

  it('falls back to the All tab for an unknown type', async () => {
    const shell = await renderPage({ q: 'bus', type: 'bogus' })
    expect(shell).toHaveAttribute('data-tab', 'all')
  })

  // A core type, so the case proves the page applies the first-value rule on
  // any build rather than depending on a tab a feature package contributes.
  it('normalizes a repeated type param to its first value', async () => {
    const shell = await renderPage({ q: 'bus', type: ['catalog', 'query'] })
    expect(shell).toHaveAttribute('data-tab', 'catalog')
  })
})
