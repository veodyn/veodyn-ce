import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { server } from '@/test/msw/server'
import type { GenerateSqlRequest } from '@/types/ai'
import { generateSql } from './client'

const generateRequest: GenerateSqlRequest = {
  prompt: 'boardings by route',
  dataset: {
    table: 'trips',
    columns: [{ name: 'boardings', type: 'integer' }],
  },
}

describe('AI client service', () => {
  it('posts the grounded request and returns generated SQL', async () => {
    let received: unknown
    server.use(
      http.post('/api/ai/generate-sql', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({
          sql: 'SELECT sum(boardings) FROM trips',
          rationale: 'Grounded in trips.',
        })
      })
    )

    const response = await generateSql(generateRequest)

    expect(received).toEqual(generateRequest)
    expect(response).toEqual({
      sql: 'SELECT sum(boardings) FROM trips',
      rationale: 'Grounded in trips.',
    })
  })

  it('throws a classified AppError with status context on a non-ok response', async () => {
    server.use(
      http.post('/api/ai/generate-sql', () =>
        HttpResponse.json({ error: 'rate limited' }, { status: 429 })
      )
    )

    const error = await generateSql(generateRequest).then(
      () => {
        throw new Error('expected generateSql to reject')
      },
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(AppError)
    const appError = error as AppError
    expect(appError.name).toBe('AppError')
    expect(appError.id).toBe(ErrorIds.AI_REQUEST_FAILED)
    expect(appError.context).toMatchObject({ status: 429 })
    expect(appError.message).toContain('429')
    expect(appError.toLogLine()).toContain('E_AI_001')
  })

  it('propagates an AbortError instead of swallowing or reclassifying it', async () => {
    server.use(
      http.post('/api/ai/generate-sql', async () => {
        await delay(100)
        return HttpResponse.json({ sql: 'SELECT 1', rationale: 'late' })
      })
    )
    const controller = new AbortController()
    const pending = generateSql(generateRequest, { signal: controller.signal })
    controller.abort()

    const error = await pending.then(
      () => {
        throw new Error('expected an aborted generateSql to reject')
      },
      (caught: unknown) => caught
    )

    expect((error as Error).name).toBe('AbortError')
    expect(error).not.toBeInstanceOf(AppError)
  })
})
