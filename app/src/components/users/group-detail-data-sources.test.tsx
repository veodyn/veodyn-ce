import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { Toaster } from '@/components/ui/sonner'
import { GroupDetail } from './group-detail'
import {
  GROUP_ID,
  dataSource,
  serveGroup,
  signInAsAdmin,
  signInAsMember,
  toastOfType,
  type Write,
} from './users-admin-fixtures'

afterEach(() => resetStores())

const PROD = dataSource({ id: 11, name: 'Production PostgreSQL', view_only: false })
const WAREHOUSE = dataSource({ id: 12, name: 'Analytics MySQL', view_only: true })

function renderDetail() {
  renderWithProviders(
    <>
      <GroupDetail groupId={String(GROUP_ID)} onBack={vi.fn()} />
      <Toaster />
    </>
  )
}

/** Opens the tab the grants live behind, which is not the default one. */
async function openDataSourcesTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: /^data sources/i }))
}

// A group's data source grant is the other half of the permissions surface:
// it decides whether the group's members can run queries against a source or
// only read what someone else ran.
describe('GroupDetail data source grants', () => {
  it('shows a normal member the grant as text, with nothing to change it with', async () => {
    const user = userEvent.setup()
    signInAsMember()
    serveGroup({ dataSources: [PROD, WAREHOUSE] })
    renderDetail()
    await openDataSourcesTab(user)

    // Positive first: both grants are on screen and legible.
    expect(await screen.findByText('Production PostgreSQL')).toBeInTheDocument()
    expect(screen.getByText('Analytics MySQL')).toBeInTheDocument()
    expect(screen.getByText('Full Access')).toBeInTheDocument()
    expect(screen.getByText('View Only')).toBeInTheDocument()

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /remove production postgresql from group/i })
    ).not.toBeInTheDocument()
  })

  it('changes a grant to view-only and posts what it changed', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ dataSources: [PROD] })
    renderDetail()
    await openDataSourcesTab(user)

    const grant = await screen.findByRole('combobox')
    expect(grant).toHaveTextContent('Full Access')

    await user.click(grant)
    await user.click(await screen.findByRole('option', { name: 'View Only' }))

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'POST',
        path: `/api/node/groups/${GROUP_ID}/data_sources/${PROD.id}`,
        body: { view_only: true },
      })
    )
    // The control reflects the grant it just made, so a reader is not left
    // looking at the old level.
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('View Only'))
  })

  it('leaves the grant where it was when the change is refused', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    serveGroup({ dataSources: [PROD] })
    server.use(
      http.post(
        `/api/node/groups/${GROUP_ID}/data_sources/${PROD.id}`,
        () => new HttpResponse('{"message":"backend refused"}', { status: 500 })
      )
    )
    renderDetail()
    await openDataSourcesTab(user)

    const grant = await screen.findByRole('combobox')
    await user.click(grant)
    await user.click(await screen.findByRole('option', { name: 'View Only' }))

    await waitFor(() => expect(toastOfType('error')).toHaveTextContent(/failed to update permis/i))
    // Showing "View Only" after a refused downgrade would say the group had
    // lost write access while the backend still grants it.
    expect(screen.getByRole('combobox')).toHaveTextContent('Full Access')
  })

  it('revokes a grant from its own row and leaves the others alone', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({ dataSources: [PROD, WAREHOUSE] })
    renderDetail()
    await openDataSourcesTab(user)

    expect(await screen.findByText('Production PostgreSQL')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Remove Production PostgreSQL from group' })
    )

    await waitFor(() =>
      expect(writes).toContainEqual({
        method: 'DELETE',
        path: `/api/node/groups/${GROUP_ID}/data_sources/${PROD.id}`,
        body: null,
      })
    )
    await waitFor(() =>
      expect(screen.queryByText('Production PostgreSQL')).not.toBeInTheDocument()
    )
    expect(screen.getByText('Analytics MySQL')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Data Sources (1)' })).toBeInTheDocument()
  })

  it('offers only the sources the group does not already have, and grants the chosen one', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { writes } = serveGroup({
      dataSources: [PROD],
      allDataSources: [
        { id: PROD.id, name: PROD.name },
        { id: WAREHOUSE.id, name: WAREHOUSE.name },
      ],
    })
    renderDetail()
    await openDataSourcesTab(user)

    const adder = await screen.findByText('Add data source...')
    await user.click(adder)

    const options = await screen.findAllByRole('option')
    const listbox = within(options[0].parentElement as HTMLElement)
    expect(listbox.getByRole('option', { name: WAREHOUSE.name })).toBeInTheDocument()
    // Already granted, so offering it again would post a duplicate grant.
    expect(listbox.queryByRole('option', { name: PROD.name })).not.toBeInTheDocument()

    await user.click(listbox.getByRole('option', { name: WAREHOUSE.name }))

    await waitFor(() =>
      expect(writes.filter((w: Write) => w.path.endsWith('/data_sources'))).toContainEqual({
        method: 'POST',
        path: `/api/node/groups/${GROUP_ID}/data_sources`,
        body: { data_source_id: WAREHOUSE.id },
      })
    )
  })
})
