// The Schedules nav item 404'd while every query already carried a schedule.
import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
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
    canEdit?: boolean
  }[]
) {
  const template = useMockDataStore.getState().queries[0]
  useMockDataStore.setState({
    queries: rows.map((row) => ({
      ...template,
      id: row.id,
      name: row.name,
      is_archived: row.archived ?? false,
      can_edit: row.canEdit ?? true,
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
  it('changes a schedule from the row it is listed on', async () => {
    // This page could show every schedule at once and change none of them, so
    // editing one meant opening the query and finding the overflow menu.
    const user = userEvent.setup()
    setQueries([{ id: 1, name: 'Every five', interval: 300, retrieved_at: HOUR_AGO }])

    renderWithProviders(<SchedulesPage />)

    await user.click(
      await screen.findByRole('button', { name: /change the refresh schedule for Every five/i })
    )
    await user.click(await screen.findByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Every 1 hour' }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    // What the write left behind, not what the row claims it sent.
    await waitFor(() =>
      expect(useMockDataStore.getState().queries[0].schedule?.interval).toBe(3600)
    )
    expect(await screen.findByText('every hour')).toBeInTheDocument()
  })

  it('opens the dialog on the row that was clicked, not on the first one', async () => {
    const user = userEvent.setup()
    setQueries([
      { id: 1, name: 'Five minutes', interval: 300, retrieved_at: HOUR_AGO },
      { id: 2, name: 'Weekly roll-up', interval: 604800, retrieved_at: HOUR_AGO },
    ])

    renderWithProviders(<SchedulesPage />)

    await user.click(
      await screen.findByRole('button', { name: /change the refresh schedule for Weekly roll-up/i })
    )

    // The weekly row's own value, seeded into the dialog: On Day only exists at
    // a weekly interval, so its presence is the proof.
    expect(await screen.findByLabelText(/on day/i)).toBeInTheDocument()
  })

  it('takes the row off the page when the schedule is set back to never', async () => {
    const user = userEvent.setup()
    setQueries([{ id: 1, name: 'Every five', interval: 300, retrieved_at: HOUR_AGO }])

    renderWithProviders(<SchedulesPage />)

    await user.click(
      await screen.findByRole('button', { name: /change the refresh schedule for Every five/i })
    )
    await user.click(await screen.findByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Never' }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(useMockDataStore.getState().queries[0].schedule).toBeNull())
    expect(screen.queryByText('Every five')).not.toBeInTheDocument()
  })

  it('shows the cadence as plain text to someone who cannot edit that query', async () => {
    setQueries([
      { id: 1, name: 'Not yours', interval: 300, retrieved_at: HOUR_AGO, canEdit: false },
    ])

    renderWithProviders(<SchedulesPage />)

    expect(await screen.findByText('every 5 minutes')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /change the refresh schedule for Not yours/i })
    ).not.toBeInTheDocument()
  })

  it('puts Edit and Remove on every row, rather than behind a menu', async () => {
    // The clickable cadence was the only way in, and a page whose controls are
    // discovered by hovering the text reads as a report you cannot act on.
    setQueries([{ id: 1, name: 'Every five', interval: 300, retrieved_at: HOUR_AGO }])

    renderWithProviders(<SchedulesPage />)

    expect(
      await screen.findByRole('button', { name: 'Edit the refresh schedule for Every five' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove the refresh schedule from Every five' })
    ).toBeInTheDocument()
  })

  it('opens the dialog on the row whose Edit button was pressed', async () => {
    const user = userEvent.setup()
    setQueries([
      { id: 1, name: 'Five minutes', interval: 300, retrieved_at: HOUR_AGO },
      { id: 2, name: 'Weekly roll-up', interval: 604800, retrieved_at: HOUR_AGO },
    ])

    renderWithProviders(<SchedulesPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Edit the refresh schedule for Weekly roll-up' })
    )

    // On Day exists only at a weekly interval, so it is the weekly row's own
    // schedule that was seeded rather than the first row's.
    expect(await screen.findByLabelText(/on day/i)).toBeInTheDocument()
  })

  it('asks before removing a schedule, and says the query itself survives', async () => {
    const user = userEvent.setup()
    setQueries([{ id: 1, name: 'Every five', interval: 300, retrieved_at: HOUR_AGO }])

    renderWithProviders(<SchedulesPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Remove the refresh schedule from Every five' })
    )

    expect(await screen.findByText(/will stop refreshing on its own/i)).toBeInTheDocument()
    // Nothing has been written yet: the dialog is the whole point.
    expect(useMockDataStore.getState().queries[0].schedule?.interval).toBe(300)

    await user.click(screen.getByRole('button', { name: 'Remove schedule' }))

    await waitFor(() => expect(useMockDataStore.getState().queries[0].schedule).toBeNull())
    expect(screen.queryByText('Every five')).not.toBeInTheDocument()
  })

  it('leaves the schedule alone when the removal is cancelled', async () => {
    const user = userEvent.setup()
    setQueries([{ id: 1, name: 'Every five', interval: 300, retrieved_at: HOUR_AGO }])

    renderWithProviders(<SchedulesPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Remove the refresh schedule from Every five' })
    )
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(useMockDataStore.getState().queries[0].schedule?.interval).toBe(300)
    expect(screen.getByText('Every five')).toBeInTheDocument()
  })

  it('offers the controls to the author of a row a list payload said nothing about', async () => {
    // QuerySerializer emits no can_edit on a list, so a gate that read only
    // that field would treat every author as a stranger to their own query.
    setQueries([{ id: 1, name: 'Mine', interval: 300, retrieved_at: HOUR_AGO, canEdit: false }])
    const author = useMockDataStore.getState().queries[0].user
    useAuthStore.setState({
      currentUser: buildCurrentUser({ ...author, permissions: [] }),
    })

    renderWithProviders(<SchedulesPage />)

    expect(
      await screen.findByRole('button', { name: 'Edit the refresh schedule for Mine' })
    ).toBeInTheDocument()
  })

  it('offers nothing to a reader who owns neither the query nor the instance', async () => {
    setQueries([{ id: 1, name: 'Not yours', interval: 300, retrieved_at: HOUR_AGO, canEdit: false }])
    useAuthStore.setState({
      currentUser: buildCurrentUser({
        id: 9_999,
        name: 'Passer by',
        email: 'passer@example.com',
        permissions: [],
      }),
    })

    renderWithProviders(<SchedulesPage />)

    expect(await screen.findByText('every 5 minutes')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit the refresh schedule for Not yours' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove the refresh schedule from Not yours' })
    ).not.toBeInTheDocument()
  })
})
