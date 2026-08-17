import { describe, expect, it } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { server } from '@/test/msw/server'
import { isAppError, ErrorIds } from '@/lib/errorIds'
import { fetchCatalog, fetchDataset, fetchDomainHub, fetchDomainHubs, fetchFeeds } from './client'

describe('catalog client service', () => {
  it('fetchCatalog returns the datasets from /api/catalog', async () => {
    server.use(
      http.get('/api/catalog', () =>
        HttpResponse.json([
          { id: 'a', origin: 'capture', writable: false },
          { id: 'b', origin: 'capture', writable: false },
        ])
      )
    )
    expect((await fetchCatalog()).map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('fetchFeeds returns the feeds from /api/feeds', async () => {
    server.use(http.get('/api/feeds', () => HttpResponse.json([{ id: 'apc-daily' }, { id: 'rail-scada' }])))
    expect((await fetchFeeds()).map((f) => f.id)).toEqual(['apc-daily', 'rail-scada'])
  })

  it('fetchFeeds rejects with a classified AppError on a non-ok response', async () => {
    server.use(http.get('/api/feeds', () => new HttpResponse(null, { status: 500 })))
    const err = await fetchFeeds().catch((e) => e)
    expect(isAppError(err)).toBe(true)
    expect(isAppError(err) && err.id).toBe(ErrorIds.CATALOG_FETCH_FAILED)
  })

  it('fetchCatalog forwards the q param', async () => {
    let seenQ: string | null = null
    server.use(
      http.get('/api/catalog', ({ request }) => {
        seenQ = new URL(request.url).searchParams.get('q')
        return HttpResponse.json([])
      })
    )
    await fetchCatalog({ q: 'bus' })
    expect(seenQ).toBe('bus')
  })

  it('fetchDataset finds one dataset by id', async () => {
    server.use(
      http.get('/api/catalog', () =>
        HttpResponse.json([
          { id: 'a', origin: 'capture', writable: false },
          { id: 'b', origin: 'capture', writable: false },
        ])
      )
    )
    expect((await fetchDataset('b'))?.id).toBe('b')
    expect(await fetchDataset('missing')).toBeNull()
  })

  it('fetchDomainHub returns the hub from /api/domains/[key]', async () => {
    server.use(http.get('/api/domains/transit', () => HttpResponse.json({ key: 'transit' })))
    expect(await fetchDomainHub('transit')).toEqual({ key: 'transit' })
  })

  it('fetchDomainHub returns null on a 404', async () => {
    server.use(http.get('/api/domains/nope', () => new HttpResponse(null, { status: 404 })))
    expect(await fetchDomainHub('nope')).toBeNull()
  })

  it('fetchDomainHubs returns the hubs from /api/domains', async () => {
    server.use(
      http.get('/api/domains', () => HttpResponse.json([{ key: 'transit' }, { key: 'water' }]))
    )
    expect(await fetchDomainHubs()).toEqual([{ key: 'transit' }, { key: 'water' }])
  })

  it('throws AppError when the domain hubs endpoint errors', async () => {
    server.use(http.get('/api/domains', () => new HttpResponse(null, { status: 500 })))
    await expect(fetchDomainHubs()).rejects.toThrow()
  })

  it('throws AppError when the catalog endpoint errors', async () => {
    server.use(http.get('/api/catalog', () => new HttpResponse(null, { status: 500 })))
    await expect(fetchCatalog()).rejects.toThrow()
  })

  it('throws AppError when the domain hub endpoint errors with a non-404 status', async () => {
    server.use(http.get('/api/domains/transit', () => new HttpResponse(null, { status: 500 })))
    await expect(fetchDomainHub('transit')).rejects.toThrow()
  })

  it('threads the caller signal into the catalog request so an abort cancels it', async () => {
    server.use(
      http.get('/api/catalog', async () => {
        await delay(100)
        return HttpResponse.json([])
      })
    )
    const controller = new AbortController()
    const promise = fetchCatalog({ signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('wraps a network failure as an AppError with CATALOG_FETCH_FAILED', async () => {
    server.use(http.get('/api/catalog', () => HttpResponse.error()))

    let caught: unknown
    try {
      await fetchCatalog()
    } catch (error) {
      caught = error
    }
    expect(isAppError(caught)).toBe(true)
    expect((caught as { id?: string }).id).toBe(ErrorIds.CATALOG_FETCH_FAILED)
  })

  it('wraps a malformed JSON body as an AppError with CATALOG_FETCH_FAILED', async () => {
    server.use(
      http.get(
        '/api/catalog',
        () => new HttpResponse('not json', { status: 200, headers: { 'content-type': 'application/json' } })
      )
    )

    let caught: unknown
    try {
      await fetchCatalog()
    } catch (error) {
      caught = error
    }
    expect(isAppError(caught)).toBe(true)
    expect((caught as { id?: string }).id).toBe(ErrorIds.CATALOG_FETCH_FAILED)
  })

  it('wraps a domain hub network failure as an AppError with CATALOG_FETCH_FAILED', async () => {
    server.use(http.get('/api/domains/transit', () => HttpResponse.error()))

    let caught: unknown
    try {
      await fetchDomainHub('transit')
    } catch (error) {
      caught = error
    }
    expect(isAppError(caught)).toBe(true)
    expect((caught as { id?: string }).id).toBe(ErrorIds.CATALOG_FETCH_FAILED)
  })

  it('does not convert an aborted catalog request into an AppError', async () => {
    server.use(
      http.get('/api/catalog', async () => {
        await delay(100)
        return HttpResponse.json([])
      })
    )
    const controller = new AbortController()
    const promise = fetchCatalog({ signal: controller.signal })
    controller.abort()

    let caught: unknown
    try {
      await promise
    } catch (error) {
      caught = error
    }
    expect(isAppError(caught)).toBe(false)
    expect((caught as { name?: string })?.name).toBe('AbortError')
  })
})
