// Settings > Formats offered a date format and the results grid showed raw ISO
// regardless, so the setting was a promise the product never kept.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { useAuthStore } from '@/stores/auth-store'
import { QueryResultTable } from '@veodyn/viz/components/query/query-result-table'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const data = {
  columns: [
    { name: 'day', type: 'date', friendly_name: 'Day' },
    { name: 'seen_at', type: 'datetime', friendly_name: 'Seen at' },
    { name: 'station', type: 'string', friendly_name: 'Station' },
  ],
  rows: [{ day: '2026-02-18', seen_at: '2026-02-18T14:05:09', station: 'north gate' }],
}

function serveFormats(settings: Record<string, string>) {
  server.use(
    http.get('/api/node/settings/organization', () => HttpResponse.json({ settings }))
  )
}

afterEach(() => resetStores())
beforeEach(() => {
  signInAsAdmin()
  serveFormats({ date_format: 'DD/MM/YY', time_format: 'HH:mm' })
})

describe('date columns in a result grid', () => {
  it('renders in the configured date format', async () => {
    renderWithProviders(<QueryResultTable data={data} />)

    await waitFor(() => expect(screen.getByText('18/02/26')).toBeInTheDocument())
  })

  it('renders a datetime with the configured time format too', async () => {
    renderWithProviders(<QueryResultTable data={data} />)

    await waitFor(() => expect(screen.getByText('18/02/26 14:05')).toBeInTheDocument())
  })

  it('follows a different configured format', async () => {
    serveFormats({ date_format: 'YYYY-MM-DD', time_format: 'HH:mm:ss' })

    renderWithProviders(<QueryResultTable data={data} />)

    await waitFor(() => expect(screen.getByText('2026-02-18 14:05:09')).toBeInTheDocument())
  })

  it('renders a non-admin the formats the session carries, without asking for org settings', async () => {
    signInAsAdmin({ isAdmin: false, permissions: ['view_query'] })
    useAuthStore.setState({
      clientConfig: { ...useAuthStore.getState().clientConfig, dateFormat: 'YYYY-MM-DD', dateTimeFormat: 'YYYY-MM-DD HH:mm:ss' },
    })
    let asked = false
    server.use(
      http.get('/api/node/settings/organization', () => {
        asked = true
        return HttpResponse.json({ message: 'forbidden' }, { status: 403 })
      })
    )

    renderWithProviders(<QueryResultTable data={data} />)

    await waitFor(() => expect(screen.getByText('2026-02-18 14:05:09')).toBeInTheDocument())
    expect(asked).toBe(false)
  })

  it('leaves a text column alone, whatever it happens to contain', async () => {
    renderWithProviders(<QueryResultTable data={data} />)

    await waitFor(() => expect(screen.getByText('north gate')).toBeInTheDocument())
  })
})
