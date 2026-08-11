import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockQueries, type MockQueryParameter } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ParametersBar } from './parameters-bar'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

afterEach(() => resetStores())

describe('ParametersBar', () => {
  it('renders one control per parameter and applies selected values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const query = {
      ...mockQueries[0],
      id: 77,
      latest_query_data_id: 901,
    }
    const parameters: MockQueryParameter[] = [
      {
        name: 'region',
        title: 'Region',
        type: 'query',
        value: 'north',
        queryId: 77,
      },
      {
        name: 'status',
        title: 'Status',
        type: 'enum',
        value: 'Open',
        enumOptions: 'Open\nClosed',
      },
    ]

    server.use(
      http.get('/api/node/queries/77', () => HttpResponse.json(query)),
      http.get('/api/node/query_results/901', () =>
        HttpResponse.json({
          query_result: {
            id: 901,
            query_hash: 'regions',
            query: 'select value, label from regions',
            data: {
              columns: [
                { name: 'value', friendly_name: 'Value', type: 'string' },
                { name: 'label', friendly_name: 'Label', type: 'string' },
              ],
              rows: [
                { value: 'north', label: 'North District' },
                { value: 'south', label: 'South District' },
              ],
            },
            data_source_id: 1,
            runtime: 0.01,
            retrieved_at: '2026-07-20T00:00:00Z',
          },
        })
      )
    )

    renderWithProviders(<ParametersBar parameters={parameters} onChange={onChange} />)

    expect(screen.getByText('Region')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()

    // Both a real `htmlFor` association: Status through the shared Select, and
    // Region through QueryBasedDropdown, which forwards its `id` onto the same
    // SelectTrigger the other branches use.
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Region')).toBeInTheDocument()

    // Editorial Light renders parameter pickers as base-ui Select comboboxes:
    // options only mount in the DOM once their trigger is opened, and the
    // trigger itself carries role="combobox" rather than a native <select>'s
    // value attribute, so selection is verified by opening + clicking an
    // option rather than by `.value` and `selectOptions`.
    const [regionTrigger, statusTrigger] = screen.getAllByRole('combobox')
    expect(screen.getAllByRole('combobox')).toHaveLength(parameters.length)
    expect(await within(regionTrigger).findByText('North District')).toBeInTheDocument()
    expect(within(statusTrigger).getByText('Open')).toBeInTheDocument()

    await user.click(regionTrigger)
    await user.click(await screen.findByRole('option', { name: 'South District' }))

    await user.click(statusTrigger)
    await user.click(await screen.findByRole('option', { name: 'Closed' }))

    await user.click(screen.getByRole('button', { name: 'Apply Changes' }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith({ region: 'south', status: 'Closed' })
  })
})
