import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { server } from '@/test/msw/server'
import type { ConverseRequest, ConverseResponse } from '@/types/ai-create'
import { converse } from './converse-client'

const converseRequest: ConverseRequest = {
  kind: 'query',
  messages: [
    { role: 'user', content: 'boardings by route' },
    { role: 'assistant', content: 'Over what period?' },
    { role: 'user', content: 'last 30 days' },
  ],
  // What the previous turn said it profiled. It has to go up with the rest of
  // the request or the service re-decides which table this is about.
  focusTable: 'trips',
}

const readyTurn: ConverseResponse = {
  reply: 'Here is a query.',
  suggestedAnswers: [],
  ready: true,
  proposal: {
    kind: 'query',
    name: 'Boardings by route',
    description: 'Draft query.',
    sql: 'SELECT route, count() FROM trips GROUP BY route',
    datasetTable: 'trips',
    vizChoiceId: 'chart-bar',
    vizOptions: { columnMapping: { route: 'x', rides: 'y' } },
  },
  focusTable: 'trips',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AI converse client service', () => {
  it('posts the whole transcript and returns the turn', async () => {
    let received: unknown
    server.use(
      http.post('/api/ai/converse', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json(readyTurn)
      })
    )

    const response = await converse(converseRequest)

    // The transcript goes up whole every turn: the endpoint keeps no state, so
    // a client that sent only the newest message would lose the goal.
    expect(received).toEqual(converseRequest)
    expect(response).toEqual(readyTurn)
  })

  it('calls the same-origin relay with the session cookie attached', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(readyTurn))

    await converse(converseRequest)

    const [path, init] = fetchSpy.mock.calls[0]
    expect(path).toBe('/api/ai/converse')
    // Same-origin relay, never the provider, and the cookie has to ride along
    // or the relay answers 401 before it reaches the provider.
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(converseRequest)
  })

  it('throws a classified AppError with status context on a non-ok response', async () => {
    server.use(
      http.post('/api/ai/converse', () =>
        HttpResponse.json({ error: 'AI generation failed' }, { status: 502 })
      )
    )

    const error = await converse(converseRequest).then(
      () => {
        throw new Error('expected converse to reject')
      },
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(AppError)
    const appError = error as AppError
    expect(appError.id).toBe(ErrorIds.AI_REQUEST_FAILED)
    expect(appError.context).toMatchObject({ status: 502 })
    expect(appError.message).toContain('502')
  })

  it('propagates an AbortError instead of swallowing or reclassifying it', async () => {
    server.use(
      http.post('/api/ai/converse', async () => {
        await delay(100)
        return HttpResponse.json(readyTurn)
      })
    )
    const controller = new AbortController()
    const pending = converse(converseRequest, { signal: controller.signal })
    controller.abort()

    const error = await pending.then(
      () => {
        throw new Error('expected an aborted converse to reject')
      },
      (caught: unknown) => caught
    )

    // A superseded turn is the caller's own decision, not an AI failure: the
    // chat must be able to tell them apart to decide whether to show an error.
    expect((error as Error).name).toBe('AbortError')
    expect(error).not.toBeInstanceOf(AppError)
  })

  it('classifies a transport failure rather than leaking it', async () => {
    server.use(http.post('/api/ai/converse', () => HttpResponse.error()))

    const error = await converse(converseRequest).then(
      () => {
        throw new Error('expected converse to reject')
      },
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).id).toBe(ErrorIds.AI_REQUEST_FAILED)
  })
})
