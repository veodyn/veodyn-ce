import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultData } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { EditVisualizationDialog } from './edit-visualization-dialog'

const data: QueryResultData = {
  columns: [{ name: 'value', friendly_name: 'Value', type: 'integer' }],
  rows: [],
}

afterEach(() => resetStores())

describe('EditVisualizationDialog', () => {
  it('renders on the dialog primitive at its workspace size', () => {
    renderWithProviders(
      <EditVisualizationDialog open onClose={() => {}} data={data} onSave={() => {}} />
    )
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveAttribute('data-slot', 'dialog-content')
    expect(panel.className).toContain('max-w-6xl')
    expect(panel.className).toContain('h-[85vh]')
  })

  it('renders the visualization fields and calls onClose from Cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <EditVisualizationDialog open onClose={onClose} data={data} onSave={() => {}} />
    )

    expect(screen.getByText(/new visualization/i)).toBeInTheDocument()
    expect(screen.getByText(/^type$/i)).toBeInTheDocument()
    expect(screen.getByText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByText(/run the query to see preview/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // The labels used to be text sitting above their controls, so a screen
  // reader announced an unnamed button and an unnamed text box.
  it('names the type and name controls, not just the text beside them', () => {
    renderWithProviders(
      <EditVisualizationDialog open onClose={() => {}} data={data} onSave={() => {}} />
    )

    expect(screen.getByLabelText('Type')).toHaveAttribute('role', 'combobox')
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  // The type select showed 'TABLE' where the option it came from reads 'Table'.
  it('shows the type option label in the trigger, not the raw value', () => {
    renderWithProviders(
      <EditVisualizationDialog open onClose={() => {}} data={data} onSave={() => {}} />
    )

    expect(screen.getByLabelText('Type')).toHaveTextContent('Table')
  })

  it('passes the current visualization to onSave', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <EditVisualizationDialog open onClose={onClose} data={data} onSave={onSave} />
    )

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith({ type: 'TABLE', name: 'Table', options: {} })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// A chart opened with every column reading '-- unused --'. The renderer infers a
// mapping when none is saved, so the preview drew something the editor claimed
// was not configured, and the first select the analyst touched replaced that
// whole inference with a one-role mapping: a y with no x, which draws nothing.
describe('EditVisualizationDialog chart column mapping', () => {
  const chartData: QueryResultData = {
    columns: [
      { name: 'day', friendly_name: 'Day', type: 'date' },
      { name: 'trips', friendly_name: 'Trips', type: 'integer' },
      { name: 'label', friendly_name: 'Label', type: 'string' },
    ],
    rows: [{ day: '2026-01-01', trips: 3, label: 'a' }],
  }

  async function openChart(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByLabelText('Type'))
    await user.click(await screen.findByRole('option', { name: 'Chart' }))
  }

  it('names each column mapping control after its column', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <EditVisualizationDialog open onClose={() => {}} data={chartData} onSave={() => {}} />
    )
    await openChart(user)

    // findBy: the editor for a type is loaded on demand, so the dialog opens
    // before the chart editor's own controls are in the DOM.
    expect(await screen.findByLabelText('Role for day')).toBeInTheDocument()
    expect(screen.getByLabelText('Role for trips')).toBeInTheDocument()
  })

  it('picks an x and a y for a chart instead of leaving every column unused', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <EditVisualizationDialog open onClose={() => {}} data={chartData} onSave={() => {}} />
    )
    await openChart(user)

    // The same choice the renderer makes with no mapping saved: first column as
    // x, numeric columns as y. The editor now says so rather than showing the
    // analyst a chart it describes as unconfigured.
    expect(screen.getByLabelText('Role for day')).toHaveTextContent('X Axis')
    expect(screen.getByLabelText('Role for trips')).toHaveTextContent('Y Axis')
    // Not everything: a string column is no series until someone says it is.
    expect(screen.getByLabelText('Role for label')).toHaveTextContent('-- unused --')
  })

  it('saves the seeded mapping, so the tab draws what the preview drew', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    renderWithProviders(
      <EditVisualizationDialog open onClose={() => {}} data={chartData} onSave={onSave} />
    )
    await openChart(user)
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHART',
        options: expect.objectContaining({ columnMapping: { day: 'x', trips: 'y' } }),
      })
    )
  })

  // An existing chart carries its own mapping, and it is the analyst's. Seeding
  // over it would silently rewrite a saved visualization on open.
  it('leaves a mapping the visualization already has alone', () => {
    renderWithProviders(
      <EditVisualizationDialog
        open
        onClose={() => {}}
        data={chartData}
        onSave={() => {}}
        visualization={{
          id: 7,
          type: 'CHART',
          name: 'Trips',
          description: '',
          options: { globalSeriesType: 'bar', columnMapping: { trips: 'x', day: 'y' } },
          created_at: '',
          updated_at: '',
        }}
      />
    )

    expect(screen.getByLabelText('Role for trips')).toHaveTextContent('X Axis')
    expect(screen.getByLabelText('Role for day')).toHaveTextContent('Y Axis')
  })

  // Nothing numeric to plot means there is no honest mapping to write, and half a
  // mapping is worse than none: it takes the fallback away without replacing it.
  it('writes no mapping when there is nothing to infer', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <EditVisualizationDialog
        open
        onClose={() => {}}
        data={{ columns: [{ name: 'only', friendly_name: 'Only', type: 'string' }], rows: [{ only: 'a' }] }}
        onSave={() => {}}
      />
    )
    await openChart(user)

    expect(screen.getByLabelText('Role for only')).toHaveTextContent('-- unused --')
  })
})
