import { describe, expect, it } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { server } from '@/test/msw/server'
import { redashApi } from '@/services/api-client'

describe('redashApi AbortSignal pass-through', () => {
  it('aborts an in-flight request when the caller signal fires', async () => {
    server.use(
      http.get('/api/node/queries', async () => {
        await delay(100)
        return HttpResponse.json({ count: 0, results: [] })
      })
    )
    const controller = new AbortController()
    const promise = redashApi.get('queries', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('forwards the q= param and resolves when not aborted', async () => {
    let seenUrl = ''
    server.use(
      http.get('/api/node/queries', ({ request }) => {
        seenUrl = request.url
        return HttpResponse.json({ count: 0, results: [] })
      })
    )
    await redashApi.get('queries', { params: { q: 'bus' } })
    expect(seenUrl).toContain('q=bus')
  })
})

describe('redashApi error messages', () => {
  it('unwraps the message field so raw JSON never reaches the UI', async () => {
    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({ message: "Couldn't find resource." }, { status: 404 })
      )
    )
    await expect(redashApi.get('users')).rejects.toThrow("Couldn't find resource.")
  })

  it('does not leave the JSON envelope in the message', async () => {
    server.use(
      http.get('/api/node/users', () =>
        HttpResponse.json({ message: 'Nope.' }, { status: 404 })
      )
    )
    await expect(redashApi.get('users')).rejects.toThrow(/^Nope\.$/)
  })

  it('falls back to the raw body when it is not a JSON envelope', async () => {
    server.use(
      http.get('/api/node/users', () => new HttpResponse('Gateway exploded', { status: 502 }))
    )
    await expect(redashApi.get('users')).rejects.toThrow('Gateway exploded')
  })

  it('falls back to the status when the body is empty', async () => {
    server.use(http.get('/api/node/users', () => new HttpResponse('', { status: 500 })))
    await expect(redashApi.get('users')).rejects.toThrow('Request failed (500)')
  })
})

describe('redashApi null-body responses', () => {
  it('resolves a 204 instead of parsing the empty body as JSON', async () => {
    // Redash answers DELETE /data_sources/:id with make_response("", 204).
    // Parsing that threw SyntaxError, so deleteDataSource rejected and the
    // deleted source stayed on screen even though the backend had removed it.
    server.use(
      http.delete('/api/node/data_sources/7', () => new HttpResponse(null, { status: 204 }))
    )
    await expect(redashApi.delete('data_sources/7')).resolves.toBeUndefined()
  })

  it('resolves a 205 the same way', async () => {
    server.use(
      http.post('/api/node/data_sources/7/reset', () => new HttpResponse(null, { status: 205 }))
    )
    await expect(redashApi.post('data_sources/7/reset')).resolves.toBeUndefined()
  })

  it('still rejects a 304 rather than passing it off as an empty success', async () => {
    server.use(
      http.get('/api/node/data_sources', () => new HttpResponse(null, { status: 304 }))
    )
    await expect(redashApi.get('data_sources')).rejects.toThrow('Request failed (304)')
  })

  it('still parses a real JSON body on an ordinary 200', async () => {
    server.use(http.get('/api/node/data_sources', () => HttpResponse.json([{ id: 7 }])))
    await expect(redashApi.get('data_sources')).resolves.toEqual([{ id: 7 }])
  })
})
