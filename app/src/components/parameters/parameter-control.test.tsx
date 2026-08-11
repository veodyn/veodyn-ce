/**
 * One parameter's control. The types below all used to fall through to a single
 * text or date box: a `date-range` rendered one `<input type="date">`, so half
 * of every range was unreachable, and the datetime types got a plain text box.
 */
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQueryParameter } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders } from '@/test/utils'
import { ParameterControl } from './parameter-control'

/**
 * The control is controlled, so the harness has to hold the value the way the
 * real parent does. With a fixed `value` prop, typing more than one character
 * re-applies every keystroke to the original value and the assertions describe
 * the harness rather than the component.
 */
function renderControl(parameter: MockQueryParameter, initial: unknown, onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState<unknown>(initial)
    return (
      <ParameterControl
        parameter={parameter}
        id="p1"
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }

  renderWithProviders(<Harness />)
  return onChange
}

const RANGE: MockQueryParameter = {
  name: 'window',
  title: 'Service window',
  type: 'date-range',
  value: { start: '2026-07-01', end: '2026-07-31' },
}

describe('range parameters', () => {
  it('offers both ends of the range, not just one', () => {
    renderControl(RANGE, RANGE.value)

    expect(screen.getByLabelText('Service window start')).toHaveValue('2026-07-01')
    expect(screen.getByLabelText('Service window end')).toHaveValue('2026-07-31')
  })

  it('keeps the other end when one end is edited', async () => {
    const user = userEvent.setup()
    const onChange = renderControl(RANGE, RANGE.value)

    await user.clear(screen.getByLabelText('Service window start'))
    await user.type(screen.getByLabelText('Service window start'), '2026-07-10')

    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-07-10', end: '2026-07-31' })
  })

  // The sentinel is what gets stored, so the window is recomputed per run.
  // Storing the resolved dates here would freeze it.
  it('stores a preset as its sentinel rather than as dates', async () => {
    const user = userEvent.setup()
    const onChange = renderControl(RANGE, RANGE.value)

    await user.click(screen.getByLabelText('Service window preset'))
    await user.click(await screen.findByRole('option', { name: 'Last 30 days' }))

    expect(onChange).toHaveBeenLastCalledWith('d_last_30_days')
  })

  it('shows a stored preset by name instead of as an empty range', () => {
    renderControl(RANGE, 'd_last_7_days')

    expect(screen.getByLabelText('Service window preset')).toHaveTextContent('Last 7 days')
    expect(screen.queryByLabelText('Service window start')).not.toBeInTheDocument()
  })

  it('returns to hand-picked dates when the preset is cleared', async () => {
    const user = userEvent.setup()
    const onChange = renderControl(RANGE, 'd_last_7_days')

    await user.click(screen.getByLabelText('Service window preset'))
    await user.click(await screen.findByRole('option', { name: 'Custom range' }))

    expect(onChange).toHaveBeenLastCalledWith({ start: '', end: '' })
  })

  it('gives a datetime range minute-precision inputs', () => {
    renderControl({ ...RANGE, type: 'datetime-range' }, { start: '', end: '' })

    expect(screen.getByLabelText('Service window start')).toHaveAttribute(
      'type',
      'datetime-local'
    )
  })
})

describe('single date parameters', () => {
  it('gives a datetime parameter a datetime control, not a text box', () => {
    renderControl({ name: 'at', title: 'When', type: 'datetime-local', value: '' }, '')

    expect(screen.getByLabelText('When')).toHaveAttribute('type', 'datetime-local')
  })

  it('asks for seconds when the type does', () => {
    renderControl({ name: 'at', title: 'When', type: 'datetime-with-seconds', value: '' }, '')

    expect(screen.getByLabelText('When')).toHaveAttribute('step', '1')
  })

  it('still renders a plain date control for a date parameter', () => {
    renderControl({ name: 'on', title: 'Day', type: 'date', value: '2026-07-15' }, '2026-07-15')

    expect(screen.getByLabelText('Day')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Day')).toHaveValue('2026-07-15')
  })
})

// Redash offers "allow multiple values" on enum and query parameters only, and
// marks it by giving the definition a multiValuesOptions object. The quoting it
// carries is applied by the backend from the query's schema, so the control's
// job is to collect a list and nothing more.
describe('multi-value parameters', () => {
  const MULTI: MockQueryParameter = {
    name: 'status',
    title: 'Status',
    type: 'enum',
    value: ['Open'],
    enumOptions: 'Open\nClosed\nPending',
    multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
  }

  it('collects a list rather than replacing the selection', async () => {
    const user = userEvent.setup()
    const onChange = renderControl(MULTI, ['Open'])

    await user.click(screen.getByLabelText('Status'))
    await user.click(await screen.findByRole('option', { name: 'Closed' }))

    expect(onChange).toHaveBeenLastCalledWith(['Open', 'Closed'])
  })

  it('drops a value that is selected again', async () => {
    const user = userEvent.setup()
    const onChange = renderControl(MULTI, ['Open', 'Closed'])

    await user.click(screen.getByLabelText('Status'))
    await user.click(await screen.findByRole('option', { name: 'Open' }))

    expect(onChange).toHaveBeenLastCalledWith(['Closed'])
  })

  // Redash allows multiple values on a query-backed dropdown too, and a transit
  // question ("compare these four routes") is far more likely to be backed by a
  // routes query than by a hand-typed enum.
  it('collects a list from a query-backed dropdown as well', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({
      queries: [{ ...mockQueries[0], id: 77, latest_query_data_id: 901 }],
      queryResults: {
        901: {
          id: 901,
          query_hash: 'routes',
          query: 'select id, name from routes',
          data: {
            columns: [
              { name: 'value', friendly_name: 'Value', type: 'string' },
              { name: 'label', friendly_name: 'Label', type: 'string' },
            ],
            rows: [
              { value: '12', label: 'Route 12' },
              { value: '40', label: 'Route 40' },
            ],
          },
          data_source_id: 1,
          runtime: 0.01,
          retrieved_at: '2026-07-20T00:00:00Z',
        },
      },
    })
    const onChange = renderControl(
      {
        name: 'routes',
        title: 'Routes',
        type: 'query',
        queryId: 77,
        value: ['12'],
        multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
      },
      ['12']
    )

    await user.click(screen.getByLabelText('Routes'))
    await user.click(await screen.findByRole('option', { name: 'Route 40' }))

    expect(onChange).toHaveBeenLastCalledWith(['12', '40'])
  })

  // The guard that keeps this from leaking into ordinary enums: without
  // multiValuesOptions the parameter is single-valued and must stay a scalar,
  // because the backend validates a list only when the definition allows one.
  it('leaves a plain enum single-valued', async () => {
    const user = userEvent.setup()
    const onChange = renderControl(
      { ...MULTI, multiValuesOptions: undefined },
      'Open'
    )

    await user.click(screen.getByLabelText('Status'))
    await user.click(await screen.findByRole('option', { name: 'Closed' }))

    expect(onChange).toHaveBeenLastCalledWith('Closed')
  })
})

describe('parameters this control did not change', () => {
  it('renders a text parameter as text', () => {
    renderControl({ name: 'route', title: 'Route', type: 'text', value: '12' }, '12')

    expect(screen.getByLabelText('Route')).toHaveAttribute('type', 'text')
  })

  it('renders a number parameter as a number, and reports numbers', async () => {
    const user = userEvent.setup()
    const onChange = renderControl({ name: 'n', title: 'Days', type: 'number', value: 7 }, 7)

    await user.clear(screen.getByLabelText('Days'))
    await user.type(screen.getByLabelText('Days'), '30')

    expect(screen.getByLabelText('Days')).toHaveAttribute('type', 'number')
    expect(onChange).toHaveBeenLastCalledWith(30)
  })
})
