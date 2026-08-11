/**
 * The Annotate control is only offered where an annotation can be stored.
 *
 * Upstream Redash has no annotations resource, so against a real backend every
 * write answered 405. The widget offered the control anyway, opening a full
 * dialog with a manual form and an AI suggester that returned real drafts with
 * an Accept on each, and none of it said the write could not land. Its own file
 * lives apart from visualization-widget.test.tsx because the capability is a
 * module constant, so switching it off is a hoisted per-file mock.
 *
 * The mock's shape mirrors services/redash/annotations: the constant is what
 * this file changes, and the three call sites stay present so nothing that
 * imports them breaks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { useMockDataStore } from '@/stores/mock-data-store'
import { mockQueries, mockQueryResults } from '@/lib/mock-data'
import type { MockDashboardWidget } from '@/lib/mock-data'

vi.mock('@/services/redash/annotations', () => ({
  ANNOTATIONS_SUPPORTED: false,
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))

import { VisualizationWidget } from './visualization-widget'

const CONFIG = toClientConfig(NEUTRAL_CONFIG)

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
    id: 501,
    dashboard_id: 1,
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 1, sizeY: 1 } },
    visualization: {
      id: 5010,
      type: 'CHART',
      name: 'Ridership by year',
      description: '',
      options: {},
      query: { id: 90001, name: 'Ridership by year', latest_query_data_id: 90002 },
    },
  }
}

describe('a widget on an instance with no annotations backend', () => {
  it('offers no Annotate control', () => {
    renderWithProviders(
      <ConfigProvider value={CONFIG}>
        <VisualizationWidget widget={widget()} isEditing={false} />
      </ConfigProvider>
    )

    expect(screen.queryByRole('button', { name: /annotate/i })).not.toBeInTheDocument()
    // The rest of the header is untouched: this hides one write that cannot
    // land, it does not strip the widget's controls.
    expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument()
  })
})
