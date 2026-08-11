// Split out of add-to-dashboard-dialog.test.tsx (file-size threshold): the
// half of this component's contract that is a refusal rather than a create,
// so a create-flow test change does not also have to think about toasts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockDashboards, mockQueries } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { Toaster } from '@/components/ui/sonner'
import { renderWithProviders, resetStores } from '@/test/utils'
import { AddToDashboardDialog } from './add-to-dashboard-dialog'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const NEW_DASHBOARD_ID = 4242
const viz = { ...mockQueries[0].visualizations[0], id: 777, name: 'Rows by day' }

beforeEach(() => {
  server.use(
    http.get('/api/node/dashboards', () =>
      HttpResponse.json({ count: 1, page: 1, page_size: 25, results: [mockDashboards[0]] })
    )
  )
})

afterEach(() => resetStores())

describe('AddToDashboardDialog failure reporting', () => {
  it('keeps the dialog open and reports a failed create', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    let widgetCalls = 0
    server.use(
      http.post('/api/node/dashboards', () =>
        HttpResponse.json({ message: 'Name already taken' }, { status: 400 })
      ),
      http.post('/api/node/widgets', () => {
        widgetCalls += 1
        return HttpResponse.json({ id: 900 })
      })
    )

    renderWithProviders(
      <>
        <AddToDashboardDialog open onClose={onClose} queryId={31} visualizations={[viz]} />
        <Toaster />
      </>
    )

    await user.click(await screen.findByRole('button', { name: 'Create new dashboard' }))
    await user.type(screen.getByLabelText(/new dashboard name/i), 'Q3 metrics')
    await user.click(screen.getByRole('button', { name: /create and add/i }))

    // Scoped to role="alert" (a refusal is assertive) rather than a bare text
    // query: the same message is also painted by the visible toast, so an
    // unscoped query matches twice.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Q3 metrics'))
    expect(screen.getByRole('alert')).toHaveTextContent('Name already taken')
    expect(onClose).not.toHaveBeenCalled()
    // Still on the form with the typed name, so the same create can be retried.
    expect(screen.getByLabelText(/new dashboard name/i)).toHaveValue('Q3 metrics')
    expect(widgetCalls).toBe(0)
  })

  it('reports a created dashboard whose widget did not land, without closing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    server.use(
      http.post('/api/node/dashboards', () =>
        HttpResponse.json({
          id: NEW_DASHBOARD_ID,
          name: 'Q3 metrics',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })
      ),
      http.post('/api/node/widgets', () =>
        HttpResponse.json({ message: 'Widget rejected' }, { status: 500 })
      )
    )

    renderWithProviders(
      <>
        <AddToDashboardDialog open onClose={onClose} queryId={31} visualizations={[viz]} />
        <Toaster />
      </>
    )

    await user.click(await screen.findByRole('button', { name: 'Create new dashboard' }))
    await user.type(screen.getByLabelText(/new dashboard name/i), 'Q3 metrics')
    await user.click(screen.getByRole('button', { name: /create and add/i }))

    // Scoped to role="alert" (a refusal is assertive) rather than a bare text
    // query: the same message is also painted by the visible toast, so an
    // unscoped query matches twice.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Rows by day'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
