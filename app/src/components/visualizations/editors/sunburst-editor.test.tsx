import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { SunburstEditor } from './sunburst-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'region', friendly_name: 'Region', type: 'string' },
  { name: 'product', friendly_name: 'Product', type: 'string' },
  { name: 'amount', friendly_name: 'Amount', type: 'integer' },
]

// The four column names sunburst-model.ts detects as Redash's edge-list
// sequence format.
const sequenceColumns: QueryResultColumn[] = [
  { name: 'sequence', friendly_name: 'Sequence', type: 'integer' },
  { name: 'stage', friendly_name: 'Stage', type: 'integer' },
  { name: 'node', friendly_name: 'Node', type: 'string' },
  { name: 'value', friendly_name: 'Value', type: 'integer' },
]

// Keeps the editor's options controlled so a real column selection is
// reflected before the select is reopened, like the actual edit dialog does.
function ControlledSunburstEditor({
  initial = {},
  editorColumns = columns,
  onChange,
}: {
  initial?: Record<string, unknown>
  editorColumns?: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}) {
  const [options, setOptions] = useState<Record<string, unknown>>(initial)
  return (
    <SunburstEditor
      options={options}
      columns={editorColumns}
      onChange={(next) => {
        onChange(next)
        setOptions(next)
      }}
    />
  )
}

function lastOptions(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

describe('SunburstEditor', () => {
  it('shows the saved value column rather than the Automatic placeholder', () => {
    renderWithProviders(
      <ControlledSunburstEditor initial={{ valueColumn: 'amount' }} onChange={vi.fn()} />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('amount')
    expect(screen.getByRole('combobox')).not.toHaveTextContent('Automatic')
  })

  it('writes valueColumn when a column is picked, keeping unrelated options', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledSunburstEditor initial={{ colorScheme: 'category10' }} onChange={onChange} />
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'amount' }))

    expect(lastOptions(onChange)).toStrictEqual({ colorScheme: 'category10', valueColumn: 'amount' })
  })

  // The behaviour this whole editor exists to get right. buildTableEntries
  // resolves the value column with `??`, so a stored '' is a real answer: it
  // beats both fallbacks and sizes every slice 0. Automatic has to leave the
  // key absent, not blank, and not present-but-undefined either.
  it('removes valueColumn when Automatic is picked instead of writing an empty string', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledSunburstEditor
        initial={{ valueColumn: 'amount', colorScheme: 'category10' }}
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Automatic' }))

    const next = lastOptions(onChange)
    // hasOwn, not a truthiness check: '' and undefined both read as "unset"
    // to `!next.valueColumn`, and only one of them actually is.
    expect(Object.hasOwn(next, 'valueColumn')).toBe(false)
    expect(next.valueColumn).not.toBe('')
    // toStrictEqual rather than toEqual, which treats a key holding undefined
    // as absent and would pass on `{ valueColumn: undefined }`.
    expect(next).toStrictEqual({ colorScheme: 'category10' })
  })

  it('tells the user the picker is ignored when the result is in sequence format', () => {
    renderWithProviders(
      <ControlledSunburstEditor editorColumns={sequenceColumns} onChange={vi.fn()} />
    )

    expect(screen.getByText(/already in sequence format/i)).toBeInTheDocument()
  })

  it('does not claim sequence format when only some of the four columns are present', () => {
    renderWithProviders(
      <ControlledSunburstEditor
        // sequence, stage and node without value: the model takes the table
        // path here, so the picker is live and the notice would be a lie.
        editorColumns={sequenceColumns.slice(0, 3)}
        onChange={vi.fn()}
      />
    )

    expect(screen.queryByText(/already in sequence format/i)).not.toBeInTheDocument()
  })
})
