import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VizDraftView } from '@/lib/chat/thread-model'
import type { VizPayload } from '@/lib/chat/viz-changes'
import { renderWithProviders } from '@/test/utils'
import { VizDraftActions } from './viz-draft-actions'
import { VizDraftCard } from './viz-draft-card'

const preview = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
const application = vi.hoisted(() => ({
  current: {
    status: 'idle',
    error: null as string | null,
    apply: vi.fn(),
    retrySync: vi.fn(),
    keep: vi.fn(),
  },
}))
const data = vi.hoisted(() => ({
  query: { data: { id: 5, latest_query_data_id: 90 } as unknown },
  result: { data: { data: { columns: [{ name: 'day' }], rows: [{ day: 1 }] } } as unknown },
}))

vi.mock('./result-view', () => ({
  ResultView: (props: Record<string, unknown>) => {
    preview.props.push(props)
    return <div>preview</div>
  },
}))
vi.mock('@/hooks/use-queries', () => ({ useQueryById: () => data.query }))
vi.mock('@/hooks/use-query-execution', () => ({ useQueryResult: () => data.result }))
vi.mock('@/hooks/use-apply-viz-change', () => ({ useApplyVizChange: () => application.current }))

const SNAPSHOT = { type: 'CHART', name: 'Bars', options: { globalSeriesType: 'bar', legend: true }, updatedAt: 'u' }

const EDIT: VizPayload = {
  mode: 'edit',
  queryId: 5,
  visualizationId: 11,
  snapshot: SNAPSHOT,
  next: { type: 'CHART', name: 'Stacked bars', options: { globalSeriesType: 'bar', series: { stacking: 'stack' } } },
}
const NEW: VizPayload = { mode: 'new', queryId: 5, next: { type: 'PIVOT', name: 'Pivot', options: { rowField: 'day' } } }
const DELETE: VizPayload = { mode: 'delete', queryId: 5, visualizationId: 11, snapshot: SNAPSHOT }

function draft(payload: VizPayload, promotions: VizDraftView['promotions'] = []): VizDraftView {
  return { id: 'd1', versions: [{ version: 1, payload }], promotions }
}

beforeEach(() => {
  vi.clearAllMocks()
  preview.props = []
  application.current = { status: 'idle', error: null, apply: vi.fn(), retrySync: vi.fn(), keep: vi.fn() }
})

describe('VizDraftCard', () => {
  it('shows the name and option changes of an edit and previews next as visualization -1', () => {
    renderWithProviders(<VizDraftCard draft={draft(EDIT)} version={1} />)
    expect(screen.getByRole('link', { name: 'Bars' })).toHaveAttribute('href', '/queries/5')
    expect(screen.getByText('Stacked bars')).toBeInTheDocument()
    expect(screen.getByText('{"stacking":"stack"}')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
    expect(screen.getByText('preview')).toBeInTheDocument()
    expect(preview.props[0].visualization).toMatchObject({ id: -1, type: 'CHART', name: 'Stacked bars', options: EDIT.mode === 'edit' ? EDIT.next.options : {} })
  })

  it('shows the options of a new visualization and the problems no stored result leaves out', () => {
    renderWithProviders(<VizDraftCard draft={draft(NEW)} version={1} />)
    expect(screen.getByText('Add visualization')).toBeInTheDocument()
    expect(screen.getByText('rowField')).toBeInTheDocument()
    expect(screen.getByText('preview')).toBeInTheDocument()
  })

  it('draws no preview while the query has no stored result', () => {
    data.result = { data: null }
    renderWithProviders(<VizDraftCard draft={draft(NEW)} version={1} />)
    expect(screen.queryByText('preview')).not.toBeInTheDocument()
    data.result = { data: { data: { columns: [{ name: 'day' }], rows: [{ day: 1 }] } } }
  })

  it('draws no preview for a delete and names what goes', () => {
    renderWithProviders(<VizDraftCard draft={draft(DELETE)} version={1} />)
    expect(screen.queryByText('preview')).not.toBeInTheDocument()
    expect(screen.getByText('Delete visualization')).toBeInTheDocument()
  })
})

describe('VizDraftActions', () => {
  it('Apply sends the change without overwrite', async () => {
    renderWithProviders(<VizDraftActions draft={draft(EDIT)} version={1} onApplied={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(application.current.apply).toHaveBeenCalledWith(false)
  })

  it('a delete needs the confirm click', async () => {
    renderWithProviders(<VizDraftActions draft={draft(DELETE)} version={1} onApplied={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete visualization' }))
    expect(application.current.apply).not.toHaveBeenCalled()
    expect(screen.getByText('Delete Bars? Its dashboard widgets go with it.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(application.current.apply).toHaveBeenCalledWith(false)
  })

  it('cancelling the confirm sends nothing', async () => {
    renderWithProviders(<VizDraftActions draft={draft(DELETE)} version={1} onApplied={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete visualization' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(application.current.apply).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete visualization' })).toBeInTheDocument()
  })

  it('a conflict offers overwrite, and overwrite resends', async () => {
    application.current.status = 'conflict'
    renderWithProviders(<VizDraftActions draft={draft(EDIT)} version={1} onApplied={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This visualization changed after the chat read it.')
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    expect(application.current.apply).toHaveBeenCalledWith(true)
    await userEvent.click(screen.getByRole('button', { name: 'Keep their changes' }))
    expect(application.current.keep).toHaveBeenCalled()
  })

  it('an unsynced save offers a retry', async () => {
    application.current.status = 'unsynced'
    renderWithProviders(<VizDraftActions draft={draft(EDIT)} version={1} onApplied={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(application.current.retrySync).toHaveBeenCalled()
  })

  it('an applied draft links to the query instead of offering Apply', () => {
    const applied = { id: 'p1', status: 'done', targetType: 'query', targetId: '5', promotedVersion: 1, receipts: [] } as never
    renderWithProviders(<VizDraftActions draft={draft(EDIT, [applied])} version={1} onApplied={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Applied/ })).toHaveAttribute('href', '/queries/5')
  })

  it('shows the failure', () => {
    application.current.error = 'Forbidden'
    renderWithProviders(<VizDraftActions draft={draft(EDIT)} version={1} onApplied={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Forbidden')
  })
})
