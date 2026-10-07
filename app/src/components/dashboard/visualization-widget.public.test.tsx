import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { mockQueries, mockQueryResults } from '@/lib/mock-data'
import type { MockDashboardWidget } from '@/lib/mock-data'

vi.mock('./annotation-dialog', () => ({
  AnnotationDialog: () => <div data-testid="annotation-dialog" />,
}))

import { VisualizationWidget } from './visualization-widget'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 400,
    top: 0,
    left: 0,
    bottom: 400,
    right: 800,
    x: 0,
    y: 0,
    toJSON() {
      return this
    },
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetStores()
  useMockDataStore.setState({ queries: [...mockQueries], queryResults: { ...mockQueryResults } })
})

function widget(): MockDashboardWidget {
  return {
    id: 502,
    dashboard_id: 1,
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 1, sizeY: 1 } },
    visualization: {
      id: 5020,
      type: 'CHART',
      name: 'Ridership by year',
      description: '',
      options: {},
      query: { id: 90001, name: 'Ridership by year', latest_query_data_id: 90002 },
    },
  }
}

describe('a widget on a shared dashboard', () => {
  it('does not mount the annotation dialog, whose formats read needs a session', () => {
    renderWithProviders(<VisualizationWidget widget={widget()} isEditing={false} isPublic />, {
      authenticated: false,
    })

    expect(screen.queryByTestId('annotation-dialog')).not.toBeInTheDocument()
  })

  it('still mounts it for a signed-in reader of the dashboard itself', () => {
    renderWithProviders(<VisualizationWidget widget={widget()} isEditing={false} />)

    expect(screen.getByTestId('annotation-dialog')).toBeInTheDocument()
  })
})
