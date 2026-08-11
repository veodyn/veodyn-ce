// The Schedules nav item 404'd while every query already carried a schedule.
import { afterEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import SchedulesPage from './page'

afterEach(() => resetStores())

const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString()
const WEEK_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

function setQueries(
  rows: {
    id: number
    name: string
    interval: number | null
    retrieved_at: string
    owner?: string
    archived?: boolean
    until?: string | null
  }[]
) {
  const template = useMockDataStore.getState().queries[0]
  useMockDataStore.setState({
    queries: rows.map((row) => ({
      ...template,
      id: row.id,
      name: row.name,
      is_archived: row.archived ?? false,
      retrieved_at: row.retrieved_at,
      user: { ...template.user, name: row.owner ?? 'Admin User' },
      schedule: row.interval
        ? { interval: row.interval, time: null, day_of_week: null, until: row.until ?? null }
        : null,
    })),
  })
}

describe('SchedulesPage', () => {
  it('lists only the queries that actually run on a schedule', async () => {
    setQueries([
      { id: 1, name: 'Hourly ridership', interval: 3600, retrieved_at: HOUR_AGO },
      { id: 2, name: 'Ad hoc lookup', interval: null, retrieved_at: HOUR_AGO },
    ])

    renderWithProviders(<SchedulesPage />)

    expect(await screen.findByText('Hourly ridership')).toBeInTheDocument()
    expect(screen.queryByText('Ad hoc lookup')).not.toBeInTheDocument()
  })

  it('leaves archived queries out', async () => {
    setQueries([
      { id: 1, name: 'Live feed', interval: 3600, retrieved_at: HOUR_AGO },
      { id: 2, name: 'Retired feed', interval: 3600, retrieved_at: HOUR_AGO, archived: true },
    ])

    renderWithProviders(<SchedulesPage />)

    expect(await screen.findByText('Live feed')).toBeInTheDocument()
    expect(screen.queryByText('Retired feed')).not.toBeInTheDocument()
  })

  it('says how often each one runs, in words', async () => {
    setQueries([{ id: 1, name: 'Every five', interval: 300, retrieved_at: HOUR_AGO }])

    renderWithProviders(<SchedulesPage />)

    expect(await screen.findByText('every 5 minutes')).toBeInTheDocument()
  })

  it('marks a query that has missed its window as late', async () => {
    setQueries([
      { id: 1, name: 'Keeping up', interval: 3600, retrieved_at: HOUR_AGO },
      { id: 2, name: 'Fallen behind', interval: 3600, retrieved_at: WEEK_AGO },
    ])

    renderWithProviders(<SchedulesPage />)

    const behind = (await screen.findByText('Fallen behind')).closest('tr') as HTMLElement
    expect(within(behind).getByText('Late')).toBeInTheDocument()

    const keeping = screen.getByText('Keeping up').closest('tr') as HTMLElement
    expect(within(keeping).getByText('On time')).toBeInTheDocument()
  })

  it('does not call an expired schedule late, because it is not running at all', async () => {
    setQueries([
      {
        id: 1,
        name: 'Ended last year',
        interval: 3600,
        retrieved_at: WEEK_AGO,
        until: '2025-01-01T00:00:00Z',
      },
    ])

    renderWithProviders(<SchedulesPage />)

    const row = (await screen.findByText('Ended last year')).closest('tr') as HTMLElement
    expect(within(row).getByText('Expired')).toBeInTheDocument()
  })

  it('puts what needs attention at the top', async () => {
    setQueries([
      { id: 1, name: 'Keeping up', interval: 3600, retrieved_at: HOUR_AGO },
      { id: 2, name: 'Fallen behind', interval: 3600, retrieved_at: WEEK_AGO },
    ])

    renderWithProviders(<SchedulesPage />)

    await screen.findByText('Fallen behind')
    const firstRow = screen.getAllByRole('row')[1]
    expect(within(firstRow).getByText('Fallen behind')).toBeInTheDocument()
  })

  it('filters by query name and by owner', async () => {
    const user = userEvent.setup()
    setQueries([
      { id: 1, name: 'Rail ridership', interval: 3600, retrieved_at: HOUR_AGO, owner: 'Ops' },
      { id: 2, name: 'Bike counts', interval: 3600, retrieved_at: HOUR_AGO, owner: 'Planning' },
    ])

    renderWithProviders(<SchedulesPage />)
    const search = await screen.findByRole('searchbox', { name: 'Search schedules' })

    await user.type(search, 'rail')
    expect(screen.queryByText('Bike counts')).not.toBeInTheDocument()
    expect(screen.getByText('Rail ridership')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'planning')
    expect(screen.getByText('Bike counts')).toBeInTheDocument()
    expect(screen.queryByText('Rail ridership')).not.toBeInTheDocument()
  })

  it('says nothing is scheduled rather than showing an empty table', async () => {
    setQueries([{ id: 1, name: 'Ad hoc only', interval: null, retrieved_at: HOUR_AGO }])

    renderWithProviders(<SchedulesPage />)

    expect(await screen.findByText(/No query has a refresh schedule yet/i)).toBeInTheDocument()
  })
})
