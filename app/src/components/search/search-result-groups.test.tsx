import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchResultGroups } from './search-result-groups'
import type { SearchResultItem, SearchSourceType } from '@/services/search/types'

function item(type: SearchSourceType, n: number): SearchResultItem {
  return { id: `${type}-${n}`, type, title: `${type} title ${n}`, href: `/${type}/${n}` }
}

describe('SearchResultGroups on the All tab', () => {
  // The results arrive in the reverse of the canonical order, so this is about
  // the ordering rule and not about which types exist: the group headings come
  // out in canonical order whatever order the sources answered in. Core types
  // drive it, which makes the case true of any build. Where a
  // registry-contributed type sorts relative to them is asserted by the suite
  // of a build that installs one.
  it('renders a heading per present type in canonical order', () => {
    render(
      <SearchResultGroups
        results={[item('catalog', 1), item('query', 1)]}
        query="title"
        activeTab="all"
      />
    )
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings[0]).toContain('Queries')
    expect(headings[1]).toContain('Datasets')
  })

  it('caps a group at five rows and links Show all to that type tab', () => {
    const results = Array.from({ length: 8 }, (_, i) => item('query', i))
    render(<SearchResultGroups results={results} query="rwa" activeTab="all" />)

    expect(screen.getAllByRole('link', { name: /query title/ })).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'Show all 8' })).toHaveAttribute(
      'href',
      '/search?q=rwa&type=query'
    )
  })

  it('places Show all after the rows it expands, not above them', () => {
    const results = Array.from({ length: 8 }, (_, i) => item('query', i))
    render(<SearchResultGroups results={results} query="rwa" activeTab="all" />)

    const rows = screen.getByRole('list')
    const showAll = screen.getByRole('link', { name: 'Show all 8' })
    expect(rows.compareDocumentPosition(showAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('omits Show all when the group is not truncated', () => {
    const results = Array.from({ length: 3 }, (_, i) => item('query', i))
    render(<SearchResultGroups results={results} query="rwa" activeTab="all" />)
    expect(screen.queryByRole('link', { name: /Show all/ })).not.toBeInTheDocument()
  })
})

describe('SearchResultGroups on a type tab', () => {
  it('renders every row uncapped with no group heading', () => {
    const results = Array.from({ length: 8 }, (_, i) => item('query', i))
    render(<SearchResultGroups results={results} query="rwa" activeTab="query" />)

    expect(screen.getAllByRole('link', { name: /query title/ })).toHaveLength(8)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Show all/ })).not.toBeInTheDocument()
  })
})
