import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultColumn, QueryResultData } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ChartSeriesOptions } from './chart-series-options'

const columns: QueryResultColumn[] = [
  { name: 'day', friendly_name: 'Day', type: 'date' },
  { name: 'revenue', friendly_name: 'Revenue', type: 'float' },
  { name: 'cost', friendly_name: 'Cost', type: 'float' },
  { name: 'region', friendly_name: 'Region', type: 'string' },
]

const data: QueryResultData = {
  columns,
  rows: [
    { day: '2026-01-01', revenue: 10, cost: 4, region: 'west' },
    { day: '2026-01-02', revenue: 12, cost: 5, region: 'east' },
    { day: '2026-01-03', revenue: 9, cost: 3, region: 'west' },
  ],
}

afterEach(() => resetStores())

// The renderers honor per-series seriesOptions today (rename, color, shape,
// curve), but only a chart authored in Redash's own editor could carry them.
// This section closes that asymmetry. Every control follows the repo rule the
// scatter/indexed case set: a shape only gets the controls its renderer
// actually reads.
describe('ChartSeriesOptions', () => {
  it('lists one row per mapped y column and writes a rename into seriesOptions', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{ globalSeriesType: 'line', columnMapping: { day: 'x', revenue: 'y', cost: 'y' } }}
        data={data}
        onChange={onChange}
      />,
    )

    const rename = screen.getByRole('textbox', { name: 'Rename revenue' })
    expect(screen.getByRole('textbox', { name: 'Rename cost' })).toBeInTheDocument()
    fireEvent.change(rename, { target: { value: 'Net revenue' } })

    expect(onChange).toHaveBeenCalledWith({ revenue: { name: 'Net revenue' } })
  })

  it('lists the distinct values of a mapped series column, not the column itself', () => {
    renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{
          globalSeriesType: 'line',
          columnMapping: { day: 'x', revenue: 'y', region: 'series' },
        }}
        data={data}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Rename west' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Rename east' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Rename region' })).not.toBeInTheDocument()
  })

  it('writes a palette slot reference when a color is picked, so the choice survives theme and tenant swaps', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{ globalSeriesType: 'line', columnMapping: { day: 'x', revenue: 'y' } }}
        data={data}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Color for revenue' }))
    await user.click(await screen.findByRole('option', { name: 'Color 2' }))

    expect(onChange).toHaveBeenCalledWith({ revenue: { color: 'var(--chart-2)' } })
  })

  it('removes the stored color when Automatic is picked, and drops an entry left empty', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{
          globalSeriesType: 'line',
          columnMapping: { day: 'x', revenue: 'y' },
          seriesOptions: { revenue: { color: 'var(--chart-3)' } },
        }}
        data={data}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Color for revenue' }))
    await user.click(await screen.findByRole('option', { name: 'Automatic' }))

    expect(onChange).toHaveBeenCalledWith({})
  })

  it('shows a stored hex from a Redash-authored chart as a custom value rather than clobbering it', () => {
    renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{
          globalSeriesType: 'line',
          columnMapping: { day: 'x', revenue: 'y' },
          seriesOptions: { revenue: { color: '#4363d8' } },
        }}
        data={data}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Color for revenue' })).toHaveTextContent(
      'Custom (#4363d8)',
    )
  })

  it('writes the Redash spelling for a per-series bar, so the document round-trips', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{ globalSeriesType: 'line', columnMapping: { day: 'x', revenue: 'y' } }}
        data={data}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Shape for revenue' }))
    await user.click(await screen.findByRole('option', { name: 'Bar' }))

    expect(onChange).toHaveBeenCalledWith({ revenue: { type: 'column' } })
  })

  it('writes a curve override for a line series', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{ globalSeriesType: 'line', columnMapping: { day: 'x', revenue: 'y' } }}
        data={data}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Curve for revenue' }))
    await user.click(await screen.findByRole('option', { name: 'Step' }))

    expect(onChange).toHaveBeenCalledWith({ revenue: { curve: 'step' } })
  })

  it('offers a bar chart rename and color but no shape or curve, which only the line/area renderer reads', () => {
    renderWithProviders(
      <ChartSeriesOptions
        chartType="bar"
        options={{ globalSeriesType: 'column', columnMapping: { day: 'x', revenue: 'y' } }}
        data={data}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Rename revenue' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Color for revenue' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Shape for revenue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Curve for revenue' })).not.toBeInTheDocument()
  })

  it('offers a right-axis column its row on an ordinary bar chart, but not on a swapped one, which never draws it', () => {
    const options = {
      globalSeriesType: 'column',
      columnMapping: { day: 'x', revenue: 'y', cost: 'yRight' },
    } as const
    const first = renderWithProviders(
      <ChartSeriesOptions chartType="bar" options={options} data={data} onChange={vi.fn()} />,
    )
    expect(screen.getByRole('textbox', { name: 'Rename cost' })).toBeInTheDocument()
    first.unmount()

    renderWithProviders(
      <ChartSeriesOptions
        chartType="bar"
        options={{ ...options, swappedAxes: true }}
        data={data}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Rename revenue' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Rename cost' })).not.toBeInTheDocument()
  })

  it('lists pie slices by value with a color only: the pie renderer keys colors by slice and ignores renames', () => {
    renderWithProviders(
      <ChartSeriesOptions
        chartType="pie"
        options={{ globalSeriesType: 'pie', columnMapping: { region: 'x', revenue: 'y' } }}
        data={data}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Color for west' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Color for east' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Rename west' })).not.toBeInTheDocument()
  })

  it('offers a scatter series its color only: the scatter renderer reads no rename, shape, or curve', () => {
    renderWithProviders(
      <ChartSeriesOptions
        chartType="scatter"
        options={{
          globalSeriesType: 'scatter',
          columnMapping: { day: 'x', revenue: 'y', region: 'series', cost: 'yRight' },
        }}
        data={data}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Color for west' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Rename west' })).not.toBeInTheDocument()
    // The scatter renderer draws no right-axis series at all, so a yRight
    // column must not surface as a row here.
    expect(screen.queryByRole('combobox', { name: /cost/ })).not.toBeInTheDocument()
  })

  it('names a scatter group of null or empty series values the way the renderer does, not String(null)', () => {
    renderWithProviders(
      <ChartSeriesOptions
        chartType="scatter"
        options={{
          globalSeriesType: 'scatter',
          columnMapping: { day: 'x', revenue: 'y', region: 'series' },
        }}
        data={{
          columns,
          rows: [
            { day: '2026-01-01', revenue: 10, cost: 4, region: null },
            { day: '2026-01-02', revenue: 12, cost: 5, region: 'west' },
            // An empty string keys the same Ungrouped label as null: its own
            // '' key would collide with the renderer's anonymous-group
            // fallback and the stored color would never be read.
            { day: '2026-01-03', revenue: 9, cost: 3, region: '' },
          ],
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Color for Ungrouped' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Color for null' })).not.toBeInTheDocument()
    // Exactly two rows: Ungrouped (null and '' merged) and west.
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('renders nothing when no series can be named or inferred', () => {
    // All-string columns: the renderer's own inference (inferYColumns) finds
    // nothing numeric to plot, so there is no series row to offer either.
    const { container } = renderWithProviders(
      <ChartSeriesOptions
        chartType="line"
        options={{ globalSeriesType: 'line', columnMapping: {} }}
        data={{
          columns: [{ name: 'label', friendly_name: 'Label', type: 'string' }],
          rows: [],
        }}
        onChange={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
