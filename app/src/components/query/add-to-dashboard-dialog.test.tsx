import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockDashboards, mockQueries } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { AddToDashboardDialog } from './add-to-dashboard-dialog'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

// Ids nothing else in the fixtures uses, so an assertion on them cannot pass
// against an implementation that hardcodes 1 or reaches for the first row of
// the dashboards list.
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

describe('AddToDashboardDialog', () => {
  it('renders dashboard search and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <AddToDashboardDialog
        open
        onClose={onClose}
        queryId={1}
        visualizations={[mockQueries[0].visualizations[0]]}
      />
    )

    expect(screen.getByText(/add to dashboard/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search dashboards/i)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('associates the visualization picker with its label when there is more than one', () => {
    renderWithProviders(
      <AddToDashboardDialog open onClose={() => {}} queryId={1} visualizations={mockQueries[0].visualizations} />
    )
    expect(screen.getByLabelText(/^visualization$/i)).toBeInTheDocument()
  })

  // The dashboards LIST endpoint returns summaries with no widgets array, which
  // normalizeDashboard turns into [], so the picker used to label every row
  // "0 widgets" against a real backend regardless of what the dashboard held.
  // It looked correct only in mock mode, where the fixtures carry widgets
  // inline, which is how it reached stage.
  it('claims no widget count for a list payload that carries no widgets', async () => {
    // What the list endpoint actually returns: the dashboard without its
    // widgets, rather than with an empty array.
    const summary: Record<string, unknown> = { ...mockDashboards[0] }
    delete summary.widgets
    server.use(
      http.get('/api/node/dashboards', () =>
        HttpResponse.json({ count: 1, page: 1, page_size: 25, results: [summary] })
      )
    )

    renderWithProviders(
      <AddToDashboardDialog
        open
        onClose={() => {}}
        queryId={1}
        visualizations={[mockQueries[0].visualizations[0]]}
      />
    )

    expect(await screen.findByText(String(summary.name))).toBeInTheDocument()
    expect(screen.queryByText(/\d+ widgets/)).not.toBeInTheDocument()
  })

  it('posts a widget for the selected dashboard', async () => {
    const user = userEvent.setup()
    let requestBody: Record<string, unknown> | undefined
    server.use(
      http.post('/api/node/widgets', async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 501,
          dashboard_id: 1,
          visualization: null,
          text: '',
          width: 1,
          options: requestBody.options,
        })
      })
    )

    renderWithProviders(
      <AddToDashboardDialog
        open
        onClose={() => {}}
        queryId={1}
        visualizations={[mockQueries[0].visualizations[0]]}
      />
    )

    await user.click(await screen.findByRole('button', { name: new RegExp(mockDashboards[0].name, 'i') }))
    await waitFor(() => expect(requestBody).toBeDefined())
    expect(requestBody).toMatchObject({
      dashboard_id: 1,
      visualization_id: 1,
      width: 1,
    })
  })

  it('offers the create path while the list still has matches', async () => {
    renderWithProviders(
      <AddToDashboardDialog open onClose={() => {}} queryId={1} visualizations={[viz]} />
    )

    expect(await screen.findByText(mockDashboards[0].name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create new dashboard' })).toBeInTheDocument()
  })

  it('pre-fills the name from a search that matched nothing', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AddToDashboardDialog open onClose={() => {}} queryId={1} visualizations={[viz]} />
    )

    await user.type(screen.getByPlaceholderText(/search dashboards/i), 'Q3 metrics')
    await user.click(await screen.findByRole('button', { name: 'Create "Q3 metrics"' }))

    expect(screen.getByLabelText(/new dashboard name/i)).toHaveValue('Q3 metrics')
  })

  it('creates the dashboard and puts the selected visualization on it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    let createBody: Record<string, unknown> | undefined
    let widgetBody: Record<string, unknown> | undefined
    server.use(
      http.post('/api/node/dashboards', async ({ request }) => {
        createBody = (await request.json()) as Record<string, unknown>
        // No widgets key, the way the create response really comes back: the
        // placement must cope with the array being absent rather than empty.
        return HttpResponse.json({
          id: NEW_DASHBOARD_ID,
          name: createBody.name,
          slug: 'q3-metrics',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })
      }),
      // create() follows the create with an un-draft update (see
      // dashboards.create.test.ts for that contract). Serve it, or the
      // catch-all answers {} and the id the widget body needs comes back
      // undefined. Still no widgets key, like the real update response.
      http.post(`/api/node/dashboards/${NEW_DASHBOARD_ID}`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: NEW_DASHBOARD_ID,
          name: 'Q3 metrics',
          slug: 'q3-metrics',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          ...body,
        })
      }),
      http.post('/api/node/widgets', async ({ request }) => {
        widgetBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 900, ...widgetBody })
      })
    )

    renderWithProviders(
      <AddToDashboardDialog open onClose={onClose} queryId={31} visualizations={[viz]} />
    )

    // Deliberately not through the empty-state shortcut: the list keeps its
    // fixture row, which carries widgets of its own, so a placement computed
    // from a list row instead of the created dashboard shows up as the wrong
    // dashboard_id and a non-zero row.
    await user.click(await screen.findByRole('button', { name: 'Create new dashboard' }))
    await user.type(screen.getByLabelText(/new dashboard name/i), 'Q3 metrics')
    await user.click(screen.getByRole('button', { name: /create and add/i }))

    await waitFor(() => expect(widgetBody).toBeDefined())
    expect(createBody).toMatchObject({ name: 'Q3 metrics' })
    // The widget lands on the dashboard that was just created, carrying the
    // visualization the dialog had selected, at the top of an empty grid.
    expect(widgetBody).toMatchObject({
      dashboard_id: NEW_DASHBOARD_ID,
      visualization_id: 777,
      width: 1,
      options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 6 } },
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  // Failure reporting (a refused create, a widget that did not land) moved to
  // add-to-dashboard-dialog.errors.test.tsx, split out for the file-size
  // threshold.

  // This component is not unmounted when it closes: the dialog primitive
  // unmounts its content, but the dialog's own state lives one level up and
  // survives. So a create form left open has to be cleared as part of
  // dismissing, or it is still there the next time any query opens the
  // dialog, one click from a duplicate dashboard.
  it('clears the create form as part of dismissing the dialog', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(
      <AddToDashboardDialog open onClose={onClose} queryId={1} visualizations={[viz]} />
    )

    await user.click(await screen.findByRole('button', { name: 'Create new dashboard' }))
    await user.type(screen.getByLabelText(/new dashboard name/i), 'Q3 metrics')
    expect(screen.getByLabelText(/new dashboard name/i)).toHaveValue('Q3 metrics')

    // The real dismiss gesture. The parent owns `open`, so it stays true here
    // and the dialog re-renders in whatever mode its own state now says.
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText(/new dashboard name/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search dashboards/i)).toBeInTheDocument()
  })

  it('disables the confirm control until the name has content', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AddToDashboardDialog open onClose={() => {}} queryId={1} visualizations={[viz]} />
    )

    await user.click(await screen.findByRole('button', { name: 'Create new dashboard' }))
    const confirm = screen.getByRole('button', { name: /create and add/i })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByLabelText(/new dashboard name/i), '   ')
    expect(confirm).toBeDisabled()

    await user.type(screen.getByLabelText(/new dashboard name/i), 'Q3')
    expect(confirm).toBeEnabled()
  })
})
