import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchTypeTabs } from './search-type-tabs'
import type { SearchTypeCounts } from '@/lib/search/grouping'
import { searchTabs } from '@/lib/search/url'

const counts: SearchTypeCounts = { query: 12, dashboard: 3, catalog: 4 }

describe('SearchTypeTabs', () => {
  // The bar renders one link per tab it is given, defaulting to this build's
  // own list, which is the core types plus whatever the feature registry
  // contributes. So the exact bar is a fact about the build, and the case below
  // names the build it means: searchTabs([]) is the list for one that installs
  // no feature packages. Every other case here drives the DEFAULT list, because
  // what each asserts (the hrefs, the active marking, the counts) is true of a
  // core tab in any build. search-type-tabs.enterprise.test.tsx asserts the bar
  // the real descriptors produce.
  it('renders All first and then a tab per source type, labelled by its type', () => {
    render(<SearchTypeTabs query="rwa" activeTab="all" tabs={searchTabs([])} />)
    const labels = screen.getAllByRole('link').map((l) => l.textContent)
    expect(labels).toEqual(['All', 'Queries', 'Dashboards', 'Datasets'])
  })

  it('links each tab to its filtered URL and All back to the unfiltered one', () => {
    render(<SearchTypeTabs query="rwa" activeTab="all" />)
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/search?q=rwa')
    expect(screen.getByRole('link', { name: 'Queries' })).toHaveAttribute(
      'href',
      '/search?q=rwa&type=query'
    )
  })

  // Driven by a core type, so the case proves the marking itself (exactly the
  // active tab carries aria-current, and All loses it once a type is active)
  // on any build rather than through a tab a feature package contributes.
  it('marks the active tab with aria-current', () => {
    render(<SearchTypeTabs query="rwa" activeTab="dashboard" />)
    expect(screen.getByRole('link', { name: 'Dashboards' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current')
  })

  // The zero matters: a count of 0 is a settled answer and has to render, not
  // be swallowed the way a falsy check would swallow it. Any type will do to
  // prove that, so it is asserted on a core one.
  it('shows counts when supplied, including a zero', () => {
    render(
      <SearchTypeTabs query="rwa" activeTab="all" counts={{ ...counts, catalog: 0 }} total={15} />
    )
    expect(screen.getByRole('link', { name: /^All\s+15$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Queries\s+12$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Datasets\s+0$/ })).toBeInTheDocument()
  })

  it('omits counts entirely while a search has not settled', () => {
    render(<SearchTypeTabs query="rwa" activeTab="all" />)
    expect(screen.getByRole('link', { name: 'Queries' })).toBeInTheDocument()
    expect(screen.queryByText('12')).not.toBeInTheDocument()
  })
})
