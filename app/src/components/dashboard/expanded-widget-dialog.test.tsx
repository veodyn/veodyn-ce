import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { PlacedAnnotation } from '@/lib/annotation-overlay'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ExpandedWidgetDialog } from './expanded-widget-dialog'

afterEach(() => {
  vi.restoreAllMocks()
  resetStores()
})

describe('ExpandedWidgetDialog', () => {
  it('renders the expanded table output and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const visualization: MockVisualization = {
      id: 1,
      type: 'TABLE',
      name: 'Ridership',
      description: '',
      options: {},
      created_at: '',
      updated_at: '',
    }
    const data: QueryResultData = {
      columns: [{ name: 'boardings', friendly_name: 'Boardings', type: 'integer' }],
      rows: [{ boardings: 42 }],
    }

    renderWithProviders(
      <ExpandedWidgetDialog
        open
        onClose={onClose}
        title="Ridership details"
        visualization={visualization}
        data={data}
      />
    )

    expect(screen.getByText(/ridership details/i)).toBeInTheDocument()
    // findBy for the table's own output: registered renderers are loaded on
    // demand, so the dialog's title is on screen before the table inside it is.
    expect(await screen.findByText(/boardings/i)).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps annotations visible when a chart widget is expanded', async () => {
    // ResponsiveContainer measures its host via getBoundingClientRect in a
    // useEffect and won't render its children (or the ReferenceLine under
    // test) until it sees a positive size; jsdom always reports an
    // all-zero rect.
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

    const visualization: MockVisualization = {
      id: 2,
      type: 'CHART',
      name: 'Ridership trend',
      description: '',
      options: {},
      created_at: '',
      updated_at: '',
    }
    const data: QueryResultData = {
      columns: [
        { name: 'day', friendly_name: 'Day', type: 'date' },
        { name: 'value', friendly_name: 'Value', type: 'integer' },
      ],
      rows: [
        { day: '2026-01-01', value: 10 },
        { day: '2026-01-02', value: 20 },
      ],
    }
    const annotations: PlacedAnnotation[] = [{ id: 1, label: 'Launch day', x: '2026-01-02', x2: null }]

    renderWithProviders(
      <ExpandedWidgetDialog
        open
        onClose={() => {}}
        title="Ridership details"
        visualization={visualization}
        data={data}
        annotations={annotations}
      />
    )

    // The chart renderer is loaded on demand, so its annotation label arrives
    // a microtask after the dialog does.
    expect(await screen.findByText('Launch day')).toBeInTheDocument()
  })
})
