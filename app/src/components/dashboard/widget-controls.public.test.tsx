import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { WidgetControls } from './widget-controls'

const NOW = Date.parse('2026-10-07T18:00:00Z')

const useCatalog = vi.fn(() => ({ data: [] }))
const useCaptures = vi.fn(() => ({ data: [] }))
vi.mock('@/hooks/use-catalog', () => ({ useCatalog: () => useCatalog() }))
vi.mock('@/hooks/use-captures', () => ({ useCaptures: () => useCaptures() }))
vi.mock('@/hooks/use-query-sql', () => ({ useQuerySqlById: () => new Map() }))

afterEach(() => {
  useCatalog.mockClear()
  useCaptures.mockClear()
  resetStores()
})

function render(isPublic: boolean) {
  return renderWithProviders(
    <WidgetControls
      now={NOW}
      retrievedAt={new Date(NOW - 3_600_000).toISOString()}
      onRefresh={() => {}}
      refreshing={false}
      onExpand={() => {}}
      onAnnotate={() => {}}
      canEdit={false}
      onEdit={() => {}}
      queryId={7}
      isPublic={isPublic}
      isEditing={false}
    />
  )
}

describe('widget controls on a shared dashboard with no session', () => {
  it('shows when the widget last ran without asking the catalog, which refuses a public viewer', () => {
    render(true)

    expect(screen.getByText(/1 hour ago|1h ago/)).toBeInTheDocument()
    expect(useCatalog).not.toHaveBeenCalled()
    expect(useCaptures).not.toHaveBeenCalled()
  })

  it('still resolves data freshness for a signed-in reader', () => {
    render(false)

    expect(useCatalog).toHaveBeenCalled()
    expect(useCaptures).toHaveBeenCalled()
  })
})
