// The instance allowlist (visualizations.enabled) is a rule about CREATION.
// These cover the two ends of that: what the type selector offers, and the fact
// that a visualization already saved with a disabled type still draws.
import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { renderWithProviders, resetStores } from '@/test/utils'
import { EditVisualizationDialog } from './edit-visualization-dialog'
import { VisualizationRenderer } from './visualization-renderer'

const data: QueryResultData = {
  columns: [
    { name: 'station', friendly_name: 'Station', type: 'string' },
    { name: 'boardings', friendly_name: 'Boardings', type: 'integer' },
  ],
  rows: [{ station: 'Union', boardings: 41 }],
}

function renderDialog(enabled: string[] | null, visualization?: MockVisualization) {
  renderWithProviders(
    <EditVisualizationDialog
      open
      onClose={() => {}}
      data={data}
      onSave={() => {}}
      visualization={visualization}
    />,
    // The whole visualizations section, because renderWithProviders merges one
    // level deep: a partial here would drop the fields it does not name.
    { config: { visualizations: { enabled, audience: {} } } }
  )
}

afterEach(() => resetStores())

describe('the type selector under an instance allowlist', () => {
  it('offers only the allowlisted types', async () => {
    const user = userEvent.setup()
    renderDialog(['TABLE', 'COUNTER'])

    await user.click(screen.getByLabelText('Type'))

    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Table',
      'Counter',
    ])
  })

  it('offers every registered type when the instance names no allowlist', async () => {
    const user = userEvent.setup()
    renderDialog(null)

    await user.click(screen.getByLabelText('Type'))

    const names = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(names).toContain('Sankey')
    expect(names).toContain('Word Cloud')
  })

  // The dialog used to open on a hardcoded TABLE, which an instance that turned
  // the table off would then create anyway from an untouched Save.
  it('starts a new visualization on a type the instance actually offers', () => {
    renderDialog(['COUNTER', 'MAP'])

    expect(screen.getByLabelText('Type')).toHaveTextContent('Counter')
  })

  // Disabling a type controls what can be created, not what can be read. The
  // select is disabled for an existing visualization, so dropping its type from
  // the list would leave the trigger blank for something drawing fine beside it.
  it('keeps the type of a visualization saved before it was disabled', () => {
    renderDialog(['COUNTER'], {
      id: 12,
      type: 'SANKEY',
      name: 'Transfers',
      description: '',
      options: {},
      created_at: '',
      updated_at: '',
    })

    expect(screen.getByLabelText('Type')).toHaveTextContent('Sankey')
  })
})

describe('a saved visualization of a disabled type', () => {
  // The invariant. The renderer resolves through getVisualization, which is
  // deliberately unfiltered: filtering it would blank every dashboard widget of
  // a type an operator turned off, silently and long after the change.
  it('still renders', async () => {
    renderWithProviders(
      <VisualizationRenderer
        visualization={{
          id: 3,
          type: 'TABLE',
          name: 'Boardings',
          description: '',
          options: {},
          created_at: '',
          updated_at: '',
        }}
        data={data}
      />,
      { config: { visualizations: { enabled: ['COUNTER'], audience: {} } } }
    )

    // findBy: the table renderer is loaded on demand. The point of the test is
    // unchanged, that a disabled type still draws rather than being refused.
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Union')).toBeInTheDocument()
    expect(screen.queryByText(/unsupported visualization type/i)).not.toBeInTheDocument()
  })
})
