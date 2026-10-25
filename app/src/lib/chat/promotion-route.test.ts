import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENDPOINT, THREAD, json, mockChatModules, signedIn, unmockChatModules } from './relay-test-harness'

afterEach(unmockChatModules)

const PROMOTION = '7a1d2c1e-0b5a-4a43-9a52-2d0f4f3c9a11'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMOTION,
    targetType: 'query',
    targetId: '7',
    promotedVersion: 1,
    targetVersionAtPromote: null,
    status: 'done',
    receipts: [{ step: 0, outcome: 'done', targetId: '7', updatedAt: '2026-10-24T10:00:00.123Z' }],
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-24T10:00:01Z',
    ...overrides,
  }
}

async function patch(body: unknown, ids = { id: THREAD, promotionId: PROMOTION }) {
  mockChatModules()
  const { PATCH } = await import('@/app/api/ai/chat/drafts/[id]/promotions/[promotionId]/route')
  const request = signedIn({
    method: 'PATCH',
    url: `http://localhost/api/ai/chat/drafts/${ids.id}/promotions/${ids.promotionId}`,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return PATCH(request, { params: Promise.resolve(ids) })
}

describe('promotion PATCH relay', () => {
  it('forwards the body to the sidecar and returns its row', async () => {
    const fetchMock = vi.fn(async () => json(row()))
    vi.stubGlobal('fetch', fetchMock)
    const body = { status: 'done', targetId: '7', receipts: [{ step: 0, outcome: 'done', targetId: '7' }] }
    const response = await patch(body)
    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe('done')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${ENDPOINT}/chat/drafts/${THREAD}/promotions/${PROMOTION}`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('passes a sidecar 404 through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'missing' }, 404)))
    expect((await patch({ status: 'failed' })).status).toBe(404)
  })

  it('answers 404 without calling out for a malformed promotion id', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await patch({ status: 'failed' }, { id: THREAD, promotionId: 'nope' })
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a body with an unknown field', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await patch({ version: 2 })).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
