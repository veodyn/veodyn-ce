import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultColumn } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { SankeyEditor } from './sankey-editor'

const columns: QueryResultColumn[] = [
  { name: 'origin', friendly_name: 'Origin', type: 'string' },
  { name: 'destination', friendly_name: 'Destination', type: 'string' },
  { name: 'passengers', friendly_name: 'Passengers', type: 'integer' },
  { name: 'notes', friendly_name: 'Notes', type: 'string' },
]

// These editors render the shadcn/base-ui Select, not a native <select>: the
// trigger is a button showing the option's label, so state is read as text and
// a change is a click on the trigger followed by a click on the option.

afterEach(() => resetStores())

describe('SankeyEditor', () => {
  it('renders every column mapping seeded from options', () => {
    renderWithProviders(
      <SankeyEditor
        options={{ columnMapping: { origin: 'source', destination: 'target', passengers: 'value' } }}
        columns={columns}
        onChange={() => {}}
      />
    )

    expect(screen.getByText(/column mapping/i)).toBeInTheDocument()
    expect(screen.getByText('origin')).toBeInTheDocument()
    expect(screen.getByText('destination')).toBeInTheDocument()
    expect(screen.getByText('passengers')).toBeInTheDocument()
    expect(screen.getByText('notes')).toBeInTheDocument()

    const controls = screen.getAllByRole('combobox')
    expect(controls).toHaveLength(4)
    expect(controls[0]).toHaveTextContent('Source')
    expect(controls[1]).toHaveTextContent('Target')
    expect(controls[2]).toHaveTextContent('Value')
    expect(controls[3]).toHaveTextContent('-- unused --')
  })

  it('passes updated options when a column mapping select changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <SankeyEditor
        options={{
          columnMapping: { origin: 'source', destination: 'target', passengers: 'value' },
          nodeWidth: 18,
        }}
        columns={columns}
        onChange={onChange}
      />
    )

    await user.click(screen.getAllByRole('combobox')[3])
    await user.click(await screen.findByRole('option', { name: 'Target' }))

    expect(onChange).toHaveBeenCalledWith({
      columnMapping: {
        origin: 'source',
        destination: 'target',
        passengers: 'value',
        notes: 'target',
      },
      nodeWidth: 18,
    })
  })
})
