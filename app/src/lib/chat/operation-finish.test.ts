import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import { finishFork, type OperationDraft } from './operation-apply'
import { STAMP } from './operation-fixtures'
import type { RedashTransport } from './transport'
import type { ChatPromotion } from './wire'

const chat = vi.hoisted(() => ({ recordPromotion: vi.fn(), patchPromotion: vi.fn() }))
vi.mock('@/services/ai/chat-client', () => chat)

const DRAFT: OperationDraft = {
  id: 'd1',
  versions: [
    {
      version: 2,
      payload: { op: 'fork', target: { kind: 'query', id: 7, name: 'Weekly revenue' }, params: {}, destructive: false },
    },
  ],
  promotions: [],
}

const PARTIAL = {
  id: 'p1',
  status: 'partial',
  targetId: '41',
  promotedVersion: 2,
  receipts: [
    { step: 0, outcome: 'done', targetId: '41', updatedAt: STAMP },
    { step: 1, outcome: 'failed', error: 'Bad gateway' },
  ],
} as unknown as ChatPromotion

function transportOf(post: unknown) {
  return {
    get: vi.fn(),
    post: vi.fn(async () => {
      if (post instanceof Error) throw post
      return post
    }),
    del: vi.fn(),
  } as unknown as RedashTransport & { post: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  chat.patchPromotion.mockImplementation(async (_d: string, _p: string, patch: object) => ({ ...PARTIAL, ...patch }))
})

describe('finishFork', () => {
  it('retries only the publish step on the recorded copy and marks the promotion done', async () => {
    const transport = transportOf({ id: 41, updated_at: STAMP })
    const outcome = await finishFork(DRAFT, PARTIAL, transport)
    expect(transport.post).toHaveBeenCalledTimes(1)
    expect(transport.post.mock.calls[0].slice(0, 2)).toEqual(['queries/41', { is_draft: false }])
    expect(chat.recordPromotion).not.toHaveBeenCalled()
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', {
      status: 'done',
      targetId: '41',
      receipts: [
        { step: 0, outcome: 'done', targetId: '41', updatedAt: STAMP },
        { step: 1, outcome: 'done', targetId: '41', updatedAt: STAMP },
      ],
    })
    expect(outcome).toMatchObject({ status: 'done', result: { forkId: 41 } })
  })

  it('keeps the promotion partial when the publish fails again', async () => {
    const outcome = await finishFork(DRAFT, PARTIAL, transportOf(new ApiError(502, 'Bad gateway')))
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(chat.patchPromotion).not.toHaveBeenCalledWith('d1', 'p1', expect.objectContaining({ status: 'done' }))
  })

  it('refuses a promotion that is not a partial fork', async () => {
    const done = { ...PARTIAL, status: 'done' } as ChatPromotion
    const transport = transportOf({ id: 41 })
    expect(await finishFork(DRAFT, done, transport)).toMatchObject({ status: 'failed' })
    expect(transport.post).not.toHaveBeenCalled()
  })
})
