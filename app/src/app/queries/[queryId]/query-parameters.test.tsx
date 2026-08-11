/**
 * A parameter bar that does not reach the execution is a control that changes
 * nothing. The page used to render `<ParametersBar onChange={() => {}} />`, so a
 * viewer could set a route, press Apply Changes, and get the same rows back with
 * no error and no hint that the value had been dropped.
 *
 * The assertions are on the payload the page hands the execution hook, because
 * that is the seam that was broken: `useExecuteQuery` already forwarded
 * `parameters` to `executeAdhoc`, and `executeAdhoc` already put them in the
 * POST body. Only the page never supplied them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQuery, type MockQueryParameter } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueryViewPage from '@/app/queries/[queryId]/page'

// QuerySourceMenu calls useRouter at the top of its render, and there is no App
// Router mounted under a component test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const { executeMutate } = vi.hoisted(() => ({ executeMutate: vi.fn() }))

// Only useExecuteQuery is replaced. useQueryResult stays real so the rest of the
// page loads the way it does in mock mode.
vi.mock('@/hooks/use-query-execution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-query-execution')>()),
  useExecuteQuery: () => ({ mutate: executeMutate, isPending: false, data: null }),
}))

const QUERY_ID = 4242

function seedQuery(parameters: MockQueryParameter[]) {
  const query: MockQuery = {
    ...mockQueries[0],
    id: QUERY_ID,
    name: 'Platform Dwell Time',
    can_edit: true,
    latest_query_data_id: null,
    schedule: null,
    tags: [],
    options: { parameters },
  }
  useMockDataStore.setState({ queries: [query] })
}

/** The values handed to the execution on the most recent run. */
function executedParameters(): unknown {
  const last = executeMutate.mock.calls.at(-1)
  return (last?.[0] as { parameters?: unknown } | undefined)?.parameters
}

async function renderPage() {
  await act(async () => {
    renderWithProviders(<QueryViewPage params={Promise.resolve({ queryId: String(QUERY_ID) })} />)
  })
}

beforeEach(() => {
  executeMutate.mockReset()
  resetStores()
  useAuthStore.setState({ isAuthenticated: true, isLoading: false })
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

describe('running a parameterised query from its detail page', () => {
  // Redash reads the stored result on load (its getMaxAge defaults to -1) and
  // only executes on an explicit action. Opening a query must not run it: a
  // page that executed on mount would hammer the warehouse once per viewer, and
  // the cost would be invisible because the rows look the same either way.
  it('does not execute anything just because the page opened', async () => {
    seedQuery([{ name: 'route_id', title: 'Route', type: 'text', value: '901' }])
    await renderPage()

    await screen.findByRole('button', { name: 'Refresh' })

    expect(executeMutate).not.toHaveBeenCalled()
  })

  it('re-runs with the value the viewer entered', async () => {
    const user = userEvent.setup()
    seedQuery([{ name: 'route_id', title: 'Route', type: 'text', value: '' }])
    await renderPage()

    await user.type(await screen.findByLabelText('Route'), '12')
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Apply Changes' }))
    })

    expect(executeMutate).toHaveBeenCalledTimes(1)
    expect(executedParameters()).toEqual({ route_id: '12' })
  })

  // Applying is what commits a value, matching ParametersBar's own contract
  // (its onChange fires on Apply, not per keystroke). What must not happen is
  // the page forgetting the commit, so the next Refresh silently reverts to the
  // saved defaults under a filled-in form.
  it('keeps the applied values for the next header Refresh', async () => {
    const user = userEvent.setup()
    seedQuery([{ name: 'route_id', title: 'Route', type: 'text', value: '901' }])
    await renderPage()

    await user.clear(await screen.findByLabelText('Route'))
    await user.type(await screen.findByLabelText('Route'), '12')
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Apply Changes' }))
    })
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    expect(executeMutate).toHaveBeenCalledTimes(2)
    expect(executedParameters()).toEqual({ route_id: '12' })
  })

  // A dynamic value is stored as its sentinel but has to reach the backend as
  // concrete dates: `d_last_7_days` is not something the SQL can interpolate.
  it('resolves a dynamic range to concrete dates on the way out', async () => {
    const user = userEvent.setup()
    seedQuery([{ name: 'window', title: 'Window', type: 'date-range', value: 'd_last_7_days' }])
    await renderPage()

    const refresh = await screen.findByRole('button', { name: 'Refresh' })
    await act(async () => {
      await user.click(refresh)
    })

    expect(executedParameters()).toEqual({
      window: {
        start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    })
  })

  // Redash disables Execute while a parameter is dirty rather than letting the
  // run go ahead with the previous values (QueryView.jsx:114). Without that, the
  // header button is a way to get results for a route you can see you replaced.
  it('will not let Refresh run while an edit is unapplied', async () => {
    const user = userEvent.setup()
    seedQuery([{ name: 'route_id', title: 'Route', type: 'text', value: '901' }])
    await renderPage()

    await user.clear(await screen.findByLabelText('Route'))
    await user.type(await screen.findByLabelText('Route'), '12')

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Apply Changes' }))
    })

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  // The results panel carries its own Run control, because the header one
  // scrolls off screen on a long query. It has to honour the same block, or the
  // trap simply moves down the page.
  it('blocks the results-panel Run button on the same unapplied edit', async () => {
    const user = userEvent.setup()
    seedQuery([{ name: 'route_id', title: 'Route', type: 'text', value: '901' }])
    await renderPage()

    expect(await screen.findByRole('button', { name: 'Run query' })).toBeEnabled()

    await user.clear(await screen.findByLabelText('Route'))
    await user.type(await screen.findByLabelText('Route'), '12')

    expect(screen.getByRole('button', { name: 'Run query' })).toBeDisabled()
  })

  // The parameter's saved `value` is its default, so the first run of the page
  // has to send that rather than nothing.
  it('sends the saved defaults when the viewer changes nothing', async () => {
    const user = userEvent.setup()
    seedQuery([{ name: 'route_id', title: 'Route', type: 'text', value: '901' }])
    await renderPage()

    const refresh = await screen.findByRole('button', { name: 'Refresh' })
    await act(async () => {
      await user.click(refresh)
    })

    expect(executedParameters()).toEqual({ route_id: '901' })
  })
})
