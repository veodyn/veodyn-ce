import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListToolbar } from './list-toolbar'

describe('ListToolbar', () => {
  it('renders the trailing slot after the count in DOM order', () => {
    render(
      <ListToolbar
        search=""
        onSearchChange={() => {}}
        searchLabel="Search messages"
        count={3}
        noun="message"
        filters={<div data-testid="filters">tabs</div>}
        trailing={<div data-testid="trailing">chip</div>}
      />
    )
    const filters = screen.getByTestId('filters')
    const search = screen.getByRole('searchbox', { name: 'Search messages' })
    const count = screen.getByRole('status')
    const trailing = screen.getByTestId('trailing')
    expect(filters.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(search.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(count.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders nothing after the count when no trailing slot is given', () => {
    render(<ListToolbar search="" onSearchChange={() => {}} searchLabel="Search KPIs" count={1} noun="KPI" />)
    const count = screen.getByRole('status')
    expect(count.nextElementSibling).toBeNull()
  })
})
