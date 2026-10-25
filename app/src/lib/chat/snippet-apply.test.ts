import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'

const recordPromotion = vi.hoisted(() => vi.fn())
const patchPromotion = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const remove = vi.hoisted(() => vi.fn())

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  recordPromotion,
  patchPromotion,
}))
vi.mock('@/services/redash/snippets', () => ({ create, update, remove }))

import { applySnippetCreate, applySnippetEdit } from './snippet-apply'
import type { SnippetEditDraft } from './snippet-drafts'
import type { ChatPromotion } from './wire'

const PENDING = {
  id: 'p1',
  targetType: 'snippet',
  targetId: null,
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'pending',
  receipts: [],
  createdAt: 'x',
  updatedAt: 'x',
} as ChatPromotion

const SNAPSHOT = { trigger: 'dt', snippet: 'old', description: '', updatedAt: '2026-10-01T00:00:00Z' }
const EDIT: SnippetEditDraft = { snippetId: 3, snapshot: SNAPSHOT, changes: { snippet: 'new' } }
const DELETE: SnippetEditDraft = { snippetId: 3, snapshot: SNAPSHOT, changes: {}, delete: true }

beforeEach(() => {
  vi.clearAllMocks()
  recordPromotion.mockResolvedValue(PENDING)
  patchPromotion.mockImplementation(async (_draft: string, _id: string, patch: object) => ({ ...PENDING, ...patch }))
})

describe('applySnippetCreate', () => {
  it('records the promotion, creates the snippet and marks the promotion done with its id', async () => {
    create.mockResolvedValue({ id: 9, updated_at: 'u' })
    const outcome = await applySnippetCreate('d1', 1, { trigger: 'dt', snippet: 'select 1', description: '' })
    expect(recordPromotion).toHaveBeenCalledWith('d1', { version: 1, targetType: 'snippet', status: 'pending' })
    expect(create).toHaveBeenCalledWith({ trigger: 'dt', snippet: 'select 1', description: '' })
    expect(patchPromotion).toHaveBeenCalledWith(
      'd1',
      'p1',
      expect.objectContaining({ status: 'done', targetId: '9' })
    )
    expect(outcome).toMatchObject({ status: 'done', promotion: { status: 'done', targetId: '9' } })
  })

  it('fails the promotion and says why when the create is refused', async () => {
    create.mockRejectedValue(new ApiError(400, 'trigger already exists'))
    const outcome = await applySnippetCreate('d1', 1, { trigger: 'dt', snippet: 's', description: '' })
    expect(outcome).toEqual({ status: 'failed', error: 'trigger already exists' })
    expect(patchPromotion).toHaveBeenCalledWith('d1', 'p1', expect.objectContaining({ status: 'failed' }))
  })

  it('reports an unsynced save when the record cannot be patched', async () => {
    create.mockResolvedValue({ id: 9, updated_at: 'u' })
    patchPromotion.mockRejectedValue(new Error('down'))
    const outcome = await applySnippetCreate('d1', 1, { trigger: 'dt', snippet: 's', description: '' })
    expect(outcome.status).toBe('unsynced')
  })

  it('writes nothing when the promotion cannot be recorded', async () => {
    recordPromotion.mockRejectedValue(new Error('refused'))
    const outcome = await applySnippetCreate('d1', 1, { trigger: 'dt', snippet: 's', description: '' })
    expect(outcome.status).toBe('failed')
    expect(create).not.toHaveBeenCalled()
  })
})

describe('applySnippetEdit', () => {
  it('sends only the changes with the stamp the chat read', async () => {
    update.mockResolvedValue({ id: 3, updated_at: 'new-stamp' })
    const outcome = await applySnippetEdit('d1', 1, EDIT, { overwrite: false })
    expect(update).toHaveBeenCalledWith(3, { snippet: 'new' }, SNAPSHOT.updatedAt)
    expect(outcome).toMatchObject({ status: 'done' })
  })

  it('overwrites without a stamp when the user chose to', async () => {
    update.mockResolvedValue({ id: 3, updated_at: 'new-stamp' })
    await applySnippetEdit('d1', 1, EDIT, { overwrite: true })
    expect(update).toHaveBeenCalledWith(3, { snippet: 'new' }, undefined)
  })

  it('asks what to do when the snippet changed after the chat read it', async () => {
    update.mockRejectedValue(new ApiError(409, 'changed'))
    expect(await applySnippetEdit('d1', 1, EDIT, { overwrite: false })).toEqual({ status: 'conflict' })
  })

  it('deletes with the stamp and records the snippet id as the target', async () => {
    remove.mockResolvedValue(undefined)
    const outcome = await applySnippetEdit('d1', 1, DELETE, { overwrite: false })
    expect(remove).toHaveBeenCalledWith(3, SNAPSHOT.updatedAt)
    expect(recordPromotion).toHaveBeenCalledWith('d1', expect.objectContaining({ targetType: 'snippet', targetId: '3' }))
    expect(outcome).toMatchObject({ status: 'done' })
  })

  it('treats a delete that races a change as a conflict too', async () => {
    remove.mockRejectedValue(new ApiError(409, 'changed'))
    expect(await applySnippetEdit('d1', 1, DELETE, { overwrite: false })).toEqual({ status: 'conflict' })
  })
})
