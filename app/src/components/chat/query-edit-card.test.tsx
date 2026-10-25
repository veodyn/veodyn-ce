import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDraftView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { QueryEditActions } from './query-edit-actions'
import { QueryEditCard } from './query-edit-card'

const apply = vi.hoisted(() => ({ applyQueryEdit: vi.fn() }))
const chat = vi.hoisted(() => ({ patchPromotion: vi.fn() }))
vi.mock('@/lib/chat/query-edit', () => apply)
vi.mock('@/lib/chat/transport', () => ({ browserTransport: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }))
vi.mock('@/services/ai/chat-client', () => chat)

function draft(promotions: EditDraftView['promotions'] = []): EditDraftView {
  return {
    id: 'd1',
    versions: [
      {
        version: 1,
        payload: {
          queryId: 5,
          snapshot: {
            id: 5,
            name: 'Trips',
            description: null,
            sql: 'select 1\nfrom t',
            dataSourceId: 2,
            parameters: [],
            tags: ['ops'],
            schedule: null,
            isDraft: false,
            updatedAt: 'u',
          },
          changes: {
            sql: 'select 2\nfrom t',
            name: 'Trips by hour',
            tags: ['ops', 'daily'],
            schedule: { interval: 86400, time: '06:30' },
          },
        },
      },
    ],
    promotions,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('QueryEditCard', () => {
  it('shows each changed field before and after, and the SQL as a line diff', () => {
    renderWithProviders(<QueryEditCard draft={draft()} version={1} />)
    expect(screen.getByRole('link', { name: 'Trips' })).toHaveAttribute('href', '/queries/5')
    expect(screen.getByText('Trips by hour')).toBeInTheDocument()
    expect(screen.getByText('ops, daily')).toBeInTheDocument()
    expect(screen.getByText('every day at 06:30')).toBeInTheDocument()
    const diff = screen.getByLabelText('SQL changes')
    expect(diff).toHaveTextContent('- select 1')
    expect(diff).toHaveTextContent('+ select 2')
  })
})

describe('QueryEditActions', () => {
  it('applies on click and reports the promotion', async () => {
    const promotion = { id: 'p1', status: 'done', targetId: '5' }
    apply.applyQueryEdit.mockResolvedValue({ status: 'done', promotion })
    const onApplied = vi.fn()
    renderWithProviders(<QueryEditActions draft={draft()} version={1} onApplied={onApplied} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', promotion))
  })

  it('offers overwrite after a conflict', async () => {
    apply.applyQueryEdit.mockResolvedValueOnce({ status: 'conflict' })
    renderWithProviders(<QueryEditActions draft={draft()} version={1} onApplied={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('button', { name: 'Overwrite' })).toBeInTheDocument()
    apply.applyQueryEdit.mockResolvedValueOnce({ status: 'done', promotion: { id: 'p2', status: 'done', targetId: '5' } })
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await vi.waitFor(() => expect(apply.applyQueryEdit.mock.calls[1][3]).toEqual({ overwrite: true }))
  })

  it('links to the query once applied, with no Apply button', () => {
    const applied = [{ id: 'p1', status: 'done', targetId: '5' }] as EditDraftView['promotions']
    renderWithProviders(<QueryEditActions draft={draft(applied)} version={1} onApplied={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.getByRole('link', { name: /Open query 5/ })).toHaveAttribute('href', '/queries/5')
  })

  it('does not treat a pending promotion as applied', () => {
    const pending = [{ id: 'p1', status: 'pending', targetId: '5' }] as EditDraftView['promotions']
    renderWithProviders(<QueryEditActions draft={draft(pending)} version={1} onApplied={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })
})

describe('QueryEditActions: a save whose record did not sync', () => {
  const pending = (createdAt: string) =>
    [
      {
        id: 'p1',
        status: 'pending',
        targetType: 'query',
        targetId: '5',
        promotedVersion: 1,
        targetVersionAtPromote: null,
        createdAt,
        updatedAt: createdAt,
        receipts: [],
      },
    ] satisfies EditDraftView['promotions']

  it('says the save happened and retries only the record', async () => {
    const patch = { status: 'done', targetId: '5', receipts: [{ step: 0, outcome: 'done' }] }
    const local = { id: 'p1', status: 'done', targetId: '5' }
    apply.applyQueryEdit.mockResolvedValue({ status: 'unsynced', promotion: local, patch })
    chat.patchPromotion.mockResolvedValue(local)
    const onApplied = vi.fn()
    renderWithProviders(<QueryEditActions draft={draft()} version={1} onApplied={onApplied} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Saved, but the record of it did not save.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', local))
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', patch)
    expect(apply.applyQueryEdit).toHaveBeenCalledTimes(1)
  })

  it('shows Apply again for a stale pending promotion', () => {
    renderWithProviders(
      <QueryEditActions draft={draft(pending('2026-10-24T09:00:00Z'))} version={1} onApplied={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.queryByText('Applied, not confirmed.')).toBeNull()
  })

  it('keeps Apply for a recent pending promotion without looking at the query', () => {
    renderWithProviders(
      <QueryEditActions draft={draft(pending(new Date().toISOString()))} version={1} onApplied={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })
})
