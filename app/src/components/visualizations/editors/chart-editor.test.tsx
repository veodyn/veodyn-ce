import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultColumn } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ChartEditor } from './chart-editor'

const columns: QueryResultColumn[] = [
  { name: 'day', friendly_name: 'Day', type: 'date' },
  { name: 'value', friendly_name: 'Value', type: 'float' },
]

afterEach(() => resetStores())

// A ticked "Index to 100" checkbox that changes nothing is worse than not
// offering it: ChartRenderer computes an indexed chartData but ScatterChart
// plots data.rows directly and never reads it, so before this fix the
// control was offered for scatter and silently did nothing. The product must
// never offer a control it does not implement.
describe('ChartEditor', () => {
  it('offers the per-series section when result data is available to name the series', () => {
    renderWithProviders(
      <ChartEditor
        options={{ globalSeriesType: 'line', columnMapping: { day: 'x', value: 'y' } }}
        columns={columns}
        data={{ columns, rows: [{ day: '2026-01-01', value: 1 }] }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Series')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Rename value' })).toBeInTheDocument()
  })

  // The renderer has honored xAxis.type === 'datetime' (a force past detection)
  // and reverseX (buildChartData reverses plotted rows) all along; neither had
  // a control. reverseX only reaches line, bar and area, whose rows go through
  // buildChartData; scatter and pie plot data.rows directly, so the checkbox is
  // not offered there. Only 'datetime' acts as an override in resolveChartConfig,
  // so the type select offers Auto and Datetime, not Redash's full list.
  it('writes the datetime x-axis override for a line chart', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'line' }} columns={columns} onChange={onChange} />,
    )

    await user.click(screen.getByRole('combobox', { name: 'X Axis Type' }))
    await user.click(await screen.findByRole('option', { name: 'Datetime' }))

    expect(onChange).toHaveBeenCalledWith({
      globalSeriesType: 'line',
      xAxis: { type: 'datetime' },
    })
  })

  it('writes Redash own auto spelling when the x-axis type is set back to Auto', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <ChartEditor
        options={{ globalSeriesType: 'line', xAxis: { type: 'datetime' } }}
        columns={columns}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'X Axis Type' }))
    await user.click(await screen.findByRole('option', { name: 'Auto (detect)' }))

    expect(onChange).toHaveBeenCalledWith({
      globalSeriesType: 'line',
      xAxis: { type: '-' },
    })
  })

  it('offers Reverse x axis for a line chart and writes it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'line' }} columns={columns} onChange={onChange} />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Reverse x axis' }))

    expect(onChange).toHaveBeenCalledWith({ globalSeriesType: 'line', reverseX: true })
  })

  it('offers scatter the x-axis type but not Reverse x axis, which only buildChartData honors', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'scatter' }} columns={columns} onChange={vi.fn()} />,
    )

    expect(screen.getByRole('combobox', { name: 'X Axis Type' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Reverse x axis' })).not.toBeInTheDocument()
  })

  it('offers a pie chart no x-axis controls at all', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'pie' }} columns={columns} onChange={vi.fn()} />,
    )

    expect(screen.queryByRole('combobox', { name: 'X Axis Type' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Reverse x axis' })).not.toBeInTheDocument()
  })

  it('does not offer Index to 100 for a scatter chart, since indexing is not implemented for scatter', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'scatter' }} columns={columns} onChange={vi.fn()} />,
    )

    expect(screen.queryByText('Index to 100')).not.toBeInTheDocument()
  })

  it('still offers Index to 100 for a line chart', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'line' }} columns={columns} onChange={vi.fn()} />,
    )

    expect(screen.getByText('Index to 100')).toBeInTheDocument()
  })

  it('still offers the log scale and range controls for a scatter chart, since those are implemented for it', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'scatter' }} columns={columns} onChange={vi.fn()} />,
    )

    expect(screen.getByText('Log scale')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('min')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('max')).toBeInTheDocument()
  })

  // Review defect: a migrated chart has no stored `indexed` at all (the value
  // is inferred from a legacy `yAxis: 1` or a `yRight` mapping), but the
  // checkbox used to read `options.indexed ?? false` directly, so it showed
  // unticked next to a preview that was rendering indexed. The checkbox must
  // read the same effective value resolveChartConfig computes.
  it('ticks Index to 100 for a migrated chart that has no stored indexed option, but did use a legacy right axis', () => {
    renderWithProviders(
      <ChartEditor
        options={{ globalSeriesType: 'line', seriesOptions: { revenue: { yAxis: 1 } } }}
        columns={columns}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Index to 100' })).toBeChecked()
  })

  // Review defect: when a chart is indexed, the renderer forcibly ignores the
  // log-scale toggle and the y min/max inputs (yAxisPropsFor in
  // axis-config.ts always returns linear/auto for an indexed chart, since a
  // log domain can't cross zero and a saved raw-magnitude bound no longer
  // means anything once every series is near 100), but the editor used to
  // present all three as live controls with no indication they do nothing.
  it('disables the log scale toggle and range inputs, with a reason, when the chart is effectively indexed', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'line', indexed: true }} columns={columns} onChange={vi.fn()} />,
    )

    // The Checkbox primitive is a `span[role="checkbox"]`, not a native form
    // control, so it signals disabled via aria-disabled rather than the
    // disabled IDL property jest-dom's toBeDisabled() checks for; asserting
    // toBeDisabled() on it would pass or fail regardless of the actual prop,
    // since jest-dom never recognises this element as disable-able at all.
    expect(screen.getByRole('checkbox', { name: 'Log scale' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByPlaceholderText('min')).toBeDisabled()
    expect(screen.getByPlaceholderText('max')).toBeDisabled()
    expect(screen.getByText(/not available on an indexed chart/i)).toBeInTheDocument()
  })

  it('leaves the log scale toggle and range inputs enabled when the chart is not indexed', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'line', indexed: false }} columns={columns} onChange={vi.fn()} />,
    )

    expect(screen.getByRole('checkbox', { name: 'Log scale' })).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByPlaceholderText('min')).not.toBeDisabled()
    expect(screen.getByPlaceholderText('max')).not.toBeDisabled()
  })

  // Review defect: an indexed chart drops its y reference lines entirely
  // (referenceLinesFor in axis-config.ts), and the editor never offers a way
  // to mark a line as an x-axis line (the only kind that survives), so every
  // reference line the editor can create is silently dropped once the chart
  // is indexed.
  it('disables adding or editing reference lines, with a reason, when the chart is effectively indexed', () => {
    renderWithProviders(
      <ChartEditor
        options={{ globalSeriesType: 'line', indexed: true, referenceLines: [{ value: 10, label: 'Target' }] }}
        columns={columns}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '+ Add' })).toBeDisabled()
    expect(screen.getByDisplayValue('10')).toBeDisabled()
    expect(screen.getByDisplayValue('Target')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove reference line' })).toBeDisabled()
    expect(screen.getByText(/reference lines are dropped on an indexed chart/i)).toBeInTheDocument()
  })

  // Review defect: effectiveIndexed always returns false while stacking is
  // on (resolve-config.ts), but the checkbox stayed clickable, so ticking it
  // wrote `indexed: true` into stored options while the controlled checkbox
  // stayed unticked and the preview stayed raw: the app silently disagreed
  // with the author's own click. Must not solve this by letting stacking and
  // indexing silently coexist (effectiveIndexed's rule stays exactly as strict
  // as it already is): the checkbox has to say why it won't move instead.
  it('disables Index to 100 under stacking instead of writing an option effectiveIndexed will ignore', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <ChartEditor
        options={{ globalSeriesType: 'bar', series: { stacking: 'stack' } }}
        columns={columns}
        onChange={onChange}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Index to 100' })
    // Same jest-dom caveat as the log-scale checkbox above: this is a
    // `span[role="checkbox"]`, so its disabled state has to be read off
    // aria-disabled, not toBeDisabled().
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText(/not available while stacking is on/i)).toBeInTheDocument()

    fireEvent.click(checkbox)
    expect(onChange).not.toHaveBeenCalled()
  })

  // A chart authored in Redash stores 'column', which is not one of the five
  // types this editor offers. Reading the raw option left the Type select on a
  // value it had no item for, and hid the bar-only Stacking control while the
  // renderer drew bars, so the editor described a chart nobody was looking at.
  it('shows a Redash column chart as Bar, with the bar-only controls', () => {
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'column' }} columns={columns} onChange={vi.fn()} />,
    )

    expect(screen.getByLabelText('Chart Type')).toHaveTextContent('Bar')
    expect(screen.getByLabelText('Stacking')).toBeInTheDocument()
  })

  // Display only. Opening the editor must not rewrite the stored option: that
  // would save 'bar' back to Redash, whose own type dropdown has no such value.
  it('does not write the resolved shape back over the stored type', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <ChartEditor options={{ globalSeriesType: 'column' }} columns={columns} onChange={onChange} />,
    )

    expect(onChange).not.toHaveBeenCalled()
  })
})
