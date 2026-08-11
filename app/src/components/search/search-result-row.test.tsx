import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchResultRow } from './search-result-row'
import type { SearchResultItem } from '@/services/search/types'

const base: SearchResultItem = {
  id: 'query-1',
  type: 'query',
  title: 'Rail Network Daily Ridership',
  href: '/queries/1',
}

describe('SearchResultRow', () => {
  it('links to the item href', () => {
    render(<SearchResultRow item={base} query="" />)
    expect(screen.getByRole('link', { name: /Rail Network Daily Ridership/ })).toHaveAttribute(
      'href',
      '/queries/1'
    )
  })

  it('emphasizes the matched part of the title', () => {
    const { container } = render(<SearchResultRow item={base} query="daily" />)
    expect(container.querySelector('.font-semibold')).toHaveTextContent('Daily')
  })

  it('does not emphasize anything when the query does not match', () => {
    const { container } = render(<SearchResultRow item={base} query="zzz" />)
    expect(container.querySelector('.font-semibold')).toBeNull()
  })

  it('renders the subtitle when present and omits it when absent', () => {
    const { rerender } = render(
      <SearchResultRow item={{ ...base, subtitle: 'Daily vehicle count' }} query="" />
    )
    expect(screen.getByText('Daily vehicle count')).toBeInTheDocument()

    rerender(<SearchResultRow item={base} query="" />)
    expect(screen.queryByText('Daily vehicle count')).not.toBeInTheDocument()
  })

  it('exposes a data-search-row hook for keyboard navigation', () => {
    const { container } = render(<SearchResultRow item={base} query="" />)
    expect(container.querySelector('[data-search-row]')).toBeInTheDocument()
  })

  it('renders a relative timestamp only when updatedAt is present', () => {
    const iso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { rerender, container } = render(
      <SearchResultRow item={{ ...base, updatedAt: iso }} query="" />
    )
    expect(container.querySelector('.tabular-nums')).toHaveTextContent('3 days ago')

    rerender(<SearchResultRow item={base} query="" />)
    expect(container.querySelector('.tabular-nums')).toBeNull()
  })
})
