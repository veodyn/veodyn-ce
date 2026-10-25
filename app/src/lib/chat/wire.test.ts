import { describe, expect, it } from 'vitest'
import { promotionPatchRequestSchema, promotionRequestSchema, promotionResponseSchema } from './wire'

const BASE = {
  id: '6f1d2c1e-0b5a-4a43-9a52-2d0f4f3c9a11',
  targetType: 'query',
  promotedVersion: 1,
  targetVersionAtPromote: null,
  createdAt: '2026-10-24T10:00:00Z',
  updatedAt: '2026-10-24T10:00:00Z',
  receipts: [],
}

describe('promotion wire schemas', () => {
  it('promotion schema accepts pending with null target', () => {
    const parsed = promotionResponseSchema.safeParse({ ...BASE, status: 'pending', targetId: null })
    expect(parsed.success).toBe(true)
  })

  it('promotion schema accepts a legacy row with no status', () => {
    const parsed = promotionResponseSchema.safeParse({ ...BASE, status: 'done', targetId: '7' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.receipts).toEqual([])
  })

  it('promotion schema keeps receipts', () => {
    const receipts = [{ step: 0, outcome: 'done', targetId: '7', updatedAt: '2026-10-24T10:00:00.123Z' }]
    const parsed = promotionResponseSchema.safeParse({ ...BASE, status: 'partial', targetId: '7', receipts })
    expect(parsed.success && parsed.data.receipts).toEqual(receipts)
  })

  it('request schema accepts a pending promotion with no target and a legacy body', () => {
    expect(promotionRequestSchema.safeParse({ version: 1, targetType: 'query', status: 'pending' }).success).toBe(true)
    expect(
      promotionRequestSchema.safeParse({ version: 1, targetType: 'query', targetId: '7', targetVersionAtPromote: 3 }).success
    ).toBe(true)
  })

  it('patch schema takes status, target and receipts and nothing else', () => {
    expect(
      promotionPatchRequestSchema.safeParse({
        status: 'done',
        targetId: '7',
        targetVersionAtPromote: 3,
        receipts: [{ step: 0, outcome: 'failed', error: 'refused' }],
      }).success
    ).toBe(true)
    expect(promotionPatchRequestSchema.safeParse({ version: 2 }).success).toBe(false)
  })
})
