import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultColumn } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { BoxPlotEditor } from './box-plot-editor'

const columns: QueryResultColumn[] = [
  { name: 'region', friendly_name: 'Region', type: 'string' },
  { name: 'revenue', friendly_name: 'Revenue', type: 'float' },
  { name: 'notes', friendly_name: 'Notes', type: 'string' },
]

// These editors render the shadcn/base-ui Select, not a native <select>: the
// trigger is a button showing the option's label, so state is read as text and
// a change is a click on the trigger followed by a click on the option.

afterEach(() => resetStores())

describe('BoxPlotEditor', () => {
  it('renders every column mapping seeded from options', () => {
    renderWithProviders(
      <BoxPlotEditor
        options={{ columnMapping: { region: 'category', revenue: 'value' } }}
        columns={columns}
        onChange={() => {}}
      />
    )

    expect(screen.getByText(/column mapping/i)).toBeInTheDocument()
    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('revenue')).toBeInTheDocument()
    expect(screen.getByText('notes')).toBeInTheDocument()

    const controls = screen.getAllByRole('combobox')
    expect(controls).toHaveLength(3)
    expect(controls[0]).toHaveTextContent('Category')
    expect(controls[1]).toHaveTextContent('Value')
    expect(controls[2]).toHaveTextContent('-- unused --')
  })

  it('passes updated options when a column mapping select changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <BoxPlotEditor
        options={{ columnMapping: { region: 'category', revenue: 'value' }, legend: true }}
        columns={columns}
        onChange={onChange}
      />
    )

    await user.click(screen.getAllByRole('combobox')[2])
    await user.click(await screen.findByRole('option', { name: 'Category' }))

    expect(onChange).toHaveBeenCalledWith({
      columnMapping: { region: 'category', revenue: 'value', notes: 'category' },
      legend: true,
    })
  })
})
