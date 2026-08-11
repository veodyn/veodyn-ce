/**
 * Excel export. CSV and TSV are built in the browser from the rows already on
 * screen, which is fine and stays. xlsx is not something to hand-roll: Redash
 * already generates it at queries/:id/results.xlsx, so this is a link to that,
 * through the proxy that now carries binary responses intact.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryResultData } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { QueryResultTable } from './query-result-table'

// The download control is gated on canExportData, which is false with nobody
// signed in.
beforeEach(() => {
  resetStores()
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({
      id: 1,
      name: 'Analyst',
      email: 'analyst@example.com',
      permissions: ['view_query'],
    }),
  })
})

const DATA: QueryResultData = {
  columns: [{ name: 'route', friendly_name: 'route', type: 'string' }],
  rows: [{ route: '12' }],
}

async function openDownloads(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Download/ }))
}

describe('the download menu', () => {
  it('offers Excel for a saved query, pointed at the backend that makes it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QueryResultTable data={DATA} queryId={8} />)

    await openDownloads(user)

    // role=menuitem, not link: inside a menu that is the correct role, and the
    // anchor is only how the download is triggered.
    expect(await screen.findByRole('menuitem', { name: /Excel/ })).toHaveAttribute(
      'href',
      '/api/node/queries/8/results.xlsx'
    )
  })

  // An ad hoc result has no saved query behind it, so there is no URL to
  // download from. Offering a dead link would be worse than not offering it.
  it('offers only the client-side formats without a saved query', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QueryResultTable data={DATA} />)

    await openDownloads(user)

    expect(await screen.findByText('CSV')).toBeInTheDocument()
    expect(screen.queryByText(/Excel/)).not.toBeInTheDocument()
  })

  it('still offers CSV and TSV', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QueryResultTable data={DATA} queryId={8} />)

    await openDownloads(user)

    expect(await screen.findByText('CSV')).toBeInTheDocument()
    expect(screen.getByText('TSV')).toBeInTheDocument()
  })
})
