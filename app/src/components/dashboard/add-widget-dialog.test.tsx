import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockQueries } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { AddWidgetDialog } from './add-widget-dialog'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

beforeEach(() => {
  server.use(
    http.get('/api/node/queries', () =>
      HttpResponse.json({ count: 1, page: 1, page_size: 25, results: [mockQueries[0]] })
    ),
    http.get('/api/node/queries/1', () => HttpResponse.json(mockQueries[0]))
  )
})

afterEach(() => resetStores())

describe('AddWidgetDialog', () => {
  it('renders the query search and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <AddWidgetDialog
        open
        onClose={onClose}
        existingWidgets={[]}
        existingDashboardParams={[]}
        onAdd={() => {}}
      />
    )

    expect(screen.getByText(/add widget/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search queries/i)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('passes the chosen query and visualization to onAdd', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <AddWidgetDialog
        open
        onClose={onClose}
        existingWidgets={[]}
        existingDashboardParams={[]}
        onAdd={onAdd}
      />
    )

    await user.click(await screen.findByRole('button', { name: new RegExp(mockQueries[0].name, 'i') }))
    expect(await screen.findByText(/choose a visualization/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /table table/i }))

    expect(onAdd).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: 1, type: 'TABLE', name: 'Table' }),
      { col: 0, row: 0, sizeX: 3, sizeY: 8 },
      []
    )
    expect(onClose).toHaveBeenCalledOnce()
  })
})
