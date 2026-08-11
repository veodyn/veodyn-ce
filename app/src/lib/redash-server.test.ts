// @vitest-environment node

// The auth gate must let a caller's abort reach the upstream Redash session
// round-trip: a cancelled AI request should not leave a session-validation
// fetch consuming a connection. These pin the signal plumbing through both
// redashFetch and requireSession, and prove the no-signal path is unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { redashFetch, requireSession } from './redash-server'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('redashFetch signal forwarding', () => {
  it('forwards an abort signal to the underlying fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    const controller = new AbortController()

    await redashFetch('/api/session', { cookie: 'session=x', signal: controller.signal })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })

  it('leaves the signal undefined when a caller passes none', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    await redashFetch('/api/session', { cookie: 'session=x' })

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeUndefined()
  })
})

describe('requireSession signal forwarding', () => {
  it('threads its signal to the Redash session round-trip', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ user: { id: 7 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    const controller = new AbortController()

    const session = await requireSession('session=x', controller.signal)

    expect(session).toEqual({ id: 7 })
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })

  it('an already-aborted signal aborts the upstream call and yields no session', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_url, init) => {
        const signal = (init as RequestInit | undefined)?.signal
        if (signal?.aborted) {
          return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        return Promise.resolve(new Response(JSON.stringify({ user: { id: 7 } }), { status: 200 }))
      })
    const controller = new AbortController()
    controller.abort()

    const session = await requireSession('session=x', controller.signal)

    expect(session).toBeNull()
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
