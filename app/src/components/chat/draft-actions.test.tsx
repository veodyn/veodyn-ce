import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { CONFLICT_MESSAGE, DraftActions } from './draft-actions'
import { QUERY_GONE_MESSAGE } from '@/hooks/use-promote-draft'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  get: vi.fn(),
  recordPromotion: vi.fn(),
  updateQuery: vi.fn(),
  updateVisualization: vi.fn(),
  createVisualization: vi.fn(),
}))

vi.mock('@/components/ai/create-chat/proposals/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: mocks.write, isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: mocks.get }))
vi.mock('@/services/ai/chat-client', () => ({ recordPromotion: mocks.recordPromotion }))
vi.mock('@/hooks/use-queries', () => ({ useUpdateQuery: () => ({ mutateAsync: mocks.updateQuery }) }))
vi.mock('@/hooks/use-visualizations', () => ({
  useUpdateVisualization: () => ({ mutateAsync: mocks.updateVisualization }),
  useCreateVisualization: () => ({ mutateAsync: mocks.createVisualization }),
}))

const PAYLOAD = {
  name: 'Average speed',
  description: 'Mean.',
  sql: 'SELECT avg(speed) FROM t',
  datasetTable: 't',
  vizChoiceId: 'chart-bar',
  vizOptions: {},
}
const PROMOTION = {
  id: 'p1',
  targetType: 'query',
  targetId: '44',
  promotedVersion: 1,
  targetVersionAtPromote: 3,
  createdAt: 'x',
}

function draft(overrides: Partial<DraftView> = {}): DraftView {
  return { id: 'd1', versions: [{ version: 1, payload: PAYLOAD }], promotions: [], ...overrides }
}

function revised(): DraftView {
  return draft({
    versions: [
      { version: 1, payload: PAYLOAD },
      { version: 2, payload: { ...PAYLOAD, sql: 'SELECT max(speed) FROM t', name: 'Top speed' } },
    ],
    promotions: [PROMOTION],
  })
}

function query(version: number) {
  return { id: 44, version, visualizations: [{ id: 7, type: 'CHART', options: { legend: true } }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.write.mockResolvedValue({ queryId: 44 })
  mocks.get.mockResolvedValue(query(3))
  mocks.recordPromotion.mockImplementation(async (_draftId, body) => ({ ...PROMOTION, ...body, promotedVersion: body.version }))
  mocks.updateQuery.mockResolvedValue({ id: 44, version: 4 })
})

describe('DraftActions', () => {
  it('saves a draft as a new query and records it', async () => {
    const onPromoted = vi.fn()
    renderWithProviders(<DraftActions draft={draft()} dataSourceId={5} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(mocks.write).toHaveBeenCalledWith(PAYLOAD, 5)
    expect(mocks.recordPromotion).toHaveBeenCalledWith('d1', {
      version: 1,
      targetType: 'query',
      targetId: '44',
      targetVersionAtPromote: 3,
    })
  })

  it('cannot save without a data source', () => {
    renderWithProviders(<DraftActions draft={draft()} dataSourceId={null} onPromoted={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save as query' })).toBeDisabled()
  })

  it('shows a saved draft as a link', () => {
    renderWithProviders(<DraftActions draft={draft({ promotions: [PROMOTION] })} dataSourceId={5} onPromoted={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Saved as query 44 · v1' })).toHaveAttribute('href', '/queries/44')
    expect(screen.queryByRole('button', { name: 'Save as query' })).not.toBeInTheDocument()
  })

  it('updates the saved query with a later version', async () => {
    const onPromoted = vi.fn()
    renderWithProviders(<DraftActions draft={revised()} dataSourceId={5} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(mocks.updateQuery).toHaveBeenCalledWith({
      id: 44,
      name: 'Top speed',
      description: 'Mean.',
      query: 'SELECT max(speed) FROM t',
      version: 3,
    })
    expect(mocks.updateVisualization).toHaveBeenCalledWith(expect.objectContaining({ queryId: 44, vizId: 7 }))
    expect(mocks.recordPromotion).toHaveBeenCalledWith('d1', expect.objectContaining({ version: 2, targetVersionAtPromote: 4 }))
  })

  it('asks before overwriting a query that changed since it was saved', async () => {
    mocks.get.mockResolvedValue(query(5))
    renderWithProviders(<DraftActions draft={revised()} dataSourceId={5} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeInTheDocument()
    expect(mocks.updateQuery).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Keep their changes' }))
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument()
    expect(mocks.updateQuery).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(mocks.updateQuery).toHaveBeenCalledWith(expect.objectContaining({ version: 5 })))
  })

  it('says so when the saved query is gone', async () => {
    mocks.get.mockResolvedValue(null)
    renderWithProviders(<DraftActions draft={revised()} dataSourceId={5} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    expect(await screen.findByText(QUERY_GONE_MESSAGE)).toBeInTheDocument()
  })

  it('shows a failed save', async () => {
    mocks.write.mockRejectedValue(new Error('permission denied'))
    renderWithProviders(<DraftActions draft={draft()} dataSourceId={5} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    expect(mocks.recordPromotion).not.toHaveBeenCalled()
  })
})
