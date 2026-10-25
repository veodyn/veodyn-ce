import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DashboardDraftView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { DashboardDraftCard } from './dashboard-draft-card'

function draft(items: DashboardDraftView['versions'][number]['payload']['items']): DashboardDraftView {
  return { id: 'dd1', versions: [{ version: 1, payload: { name: 'Overview', description: '', items } }], promotions: [] }
}

function render(view: DashboardDraftView) {
  return renderWithProviders(
    <DashboardDraftCard draft={view} version={1} queryDrafts={{}} resultForSql={() => undefined} />
  )
}

describe('DashboardDraftCard with text items', () => {
  it('lists a text item by its first line, apart from the charts', () => {
    render(
      draft([
        { kind: 'existing', queryId: 12, visualizationId: 31, title: 'Trips' },
        { kind: 'text', text: '## Notes\nSecond line' },
        { kind: 'text', text: '## Notes\nOther body' },
      ])
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('1. Trips')).toBeInTheDocument()
    expect(within(items[1]).getByText('2. Text: ## Notes')).toBeInTheDocument()
    expect(within(items[2]).getByText('3. Text: ## Notes')).toBeInTheDocument()
  })

  it('counts only the charts in the badge and names the text boxes', () => {
    render(
      draft([
        { kind: 'existing', queryId: 12, visualizationId: 31 },
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'b' },
      ])
    )
    expect(screen.getByText('1 chart')).toBeInTheDocument()
    expect(screen.getByText('2 text boxes')).toBeInTheDocument()
  })
})
