import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultColumn } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { HeatmapEditor } from './heatmap-editor'

const columns: QueryResultColumn[] = [
  { name: 'month', friendly_name: 'Month', type: 'date' },
  { name: 'region', friendly_name: 'Region', type: 'string' },
  { name: 'revenue', friendly_name: 'Revenue', type: 'float' },
  { name: 'notes', friendly_name: 'Notes', type: 'string' },
]

// These editors render the shadcn/base-ui Select, not a native <select>: the
// trigger is a button showing the option's label, so state is read as text and
// a change is a click on the trigger followed by a click on the option.
//
// Every control below is reached by its ACCESSIBLE NAME rather than by its
// index in getAllByRole('combobox'). An index passes just as well when the
// label beside a trigger is connected to nothing at all, which is exactly the
// defect these controls had: a screen-reader user heard the current value and
// nothing about which option it controlled. Asking for the control by name is
// the assertion that the name exists.

afterEach(() => resetStores())

describe('HeatmapEditor', () => {
  it('renders every column mapping seeded from options', () => {
    renderWithProviders(
      <HeatmapEditor
        options={{ columnMapping: { month: 'x', region: 'y', revenue: 'value' } }}
        columns={columns}
        onChange={() => {}}
      />
    )

    expect(screen.getByText(/column mapping/i)).toBeInTheDocument()
    expect(screen.getByText('month')).toBeInTheDocument()
    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('revenue')).toBeInTheDocument()
    expect(screen.getByText('notes')).toBeInTheDocument()

    expect(screen.getAllByRole('combobox')).toHaveLength(7)
    expect(screen.getByRole('combobox', { name: 'month' })).toHaveTextContent('X (columns)')
    expect(screen.getByRole('combobox', { name: 'region' })).toHaveTextContent('Y (rows)')
    expect(screen.getByRole('combobox', { name: 'revenue' })).toHaveTextContent('Value')
    expect(screen.getByRole('combobox', { name: 'notes' })).toHaveTextContent('-- unused --')
    expect(screen.getByRole('combobox', { name: 'Aggregation' })).toHaveTextContent('Sum')
    expect(screen.getByRole('combobox', { name: 'Show values' })).toHaveTextContent('Auto (hide on dense grids)')
    expect(screen.getByRole('combobox', { name: 'Sort rows' })).toHaveTextContent('Source order')
  })

  it('passes updated options when a column mapping select changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <HeatmapEditor
        options={{
          columnMapping: { month: 'x', region: 'y', revenue: 'value' },
          colorScheme: 'Blues',
        }}
        columns={columns}
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('combobox', { name: 'notes' }))
    await user.click(await screen.findByRole('option', { name: 'Y (rows)' }))

    expect(onChange).toHaveBeenCalledWith({
      columnMapping: { month: 'x', region: 'y', revenue: 'value', notes: 'y' },
      colorScheme: 'Blues',
    })
  })
})

// Tasks 3, 4 and 6 each added a stored option (showValues, clipOutliers,
// sortRows) with no editor control. Every option carries a DIFFERENT
// non-default seeded value below, so a control reading (or writing) the
// wrong key cannot hide behind another control's value happening to match.
describe('HeatmapEditor: show values, clip outliers and sort rows controls', () => {
  const seededOptions = {
    columnMapping: { month: 'x', region: 'y', revenue: 'value' },
    aggregation: 'avg',
    showValues: 'never',
    clipOutliers: true,
    sortRows: 'peak',
  }

  const showValuesSelect = () => screen.getByRole('combobox', { name: 'Show values' })
  const sortRowsSelect = () => screen.getByRole('combobox', { name: 'Sort rows' })

  // A control that writes its default the moment it mounts would rewrite
  // every saved heatmap's stored JSON the first time an author opens the
  // editor, which the migration must stay read-only against. This test
  // would still pass a component that renders nothing at all for the three
  // controls; the next two tests close that gap by asserting the controls
  // are present and reflect seeded values.
  it('does not call onChange on mount', () => {
    const onChange = vi.fn()

    renderWithProviders(
      <HeatmapEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    expect(onChange).not.toHaveBeenCalled()
  })

  // This test alone would still pass an implementation that renders the
  // label text unconditionally instead of reading it off `options` (a
  // hardcoded string looks identical to a correctly wired default). The
  // "reflects seeded non-default values" test below closes that gap by
  // seeding a different value for every control.
  it('defaults show values to auto, clip outliers to unchecked, and sort rows to source order when absent from options', () => {
    renderWithProviders(
      <HeatmapEditor
        options={{ columnMapping: { month: 'x' } }}
        columns={columns}
        onChange={() => {}}
      />
    )

    expect(showValuesSelect()).toHaveTextContent('Auto (hide on dense grids)')
    expect(sortRowsSelect()).toHaveTextContent('Source order')
    expect(screen.getByRole('checkbox', { name: /clip outliers/i })).not.toBeChecked()
  })

  // This test reads each control's displayed value but never interacts with
  // it, so it would still pass an implementation that displays the right
  // value yet writes an update to the wrong key on change. The payload
  // assertions further down close that gap.
  it('reflects seeded non-default values for all three controls, each off its own key', () => {
    renderWithProviders(
      <HeatmapEditor options={seededOptions} columns={columns} onChange={() => {}} />
    )

    expect(showValuesSelect()).toHaveTextContent('Never')
    expect(sortRowsSelect()).toHaveTextContent('By peak cell')
    expect(screen.getByRole('checkbox', { name: /clip outliers/i })).toBeChecked()
  })

  // The fixture trap named in the brief: onChange({ sortRows: 'total' })
  // without spreading `options` would drop columnMapping and aggregation on
  // the floor and still satisfy a changed-key-only assertion. Asserting the
  // WHOLE payload catches that, and also catches a control wired to a
  // sibling key (e.g. writing showValues into clipOutliers).
  it('passes the whole options object, with the other two new keys unchanged, when show values changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <HeatmapEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(showValuesSelect())
    await user.click(await screen.findByRole('option', { name: 'Always' }))

    expect(onChange).toHaveBeenCalledWith({
      columnMapping: { month: 'x', region: 'y', revenue: 'value' },
      aggregation: 'avg',
      showValues: 'always',
      clipOutliers: true,
      sortRows: 'peak',
    })
  })

  // Same trap for the checkbox: asserting `clipOutliers: false` in the full
  // payload, not just that onChange fired, since a control writing
  // `undefined` or `''` on uncheck would look identical to a bare
  // "fired" assertion but get stripped differently downstream.
  it('passes the whole options object, with clipOutliers false, when the checkbox is unchecked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <HeatmapEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(screen.getByRole('checkbox', { name: /clip outliers/i }))

    expect(onChange).toHaveBeenCalledWith({
      columnMapping: { month: 'x', region: 'y', revenue: 'value' },
      aggregation: 'avg',
      showValues: 'never',
      clipOutliers: false,
      sortRows: 'peak',
    })
  })

  it('passes the whole options object, with the other two new keys unchanged, when sort rows changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <HeatmapEditor options={seededOptions} columns={columns} onChange={onChange} />
    )

    await user.click(sortRowsSelect())
    await user.click(await screen.findByRole('option', { name: 'By row total' }))

    expect(onChange).toHaveBeenCalledWith({
      columnMapping: { month: 'x', region: 'y', revenue: 'value' },
      aggregation: 'avg',
      showValues: 'never',
      clipOutliers: true,
      sortRows: 'total',
    })
  })
})
