import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAppError } from '@/lib/errorIds'
import {
  fetchRedashTagVocabulary,
  fetchTagVocabulary,
  putObjectTags,
  TagErrorCause,
  tagErrorCause,
} from './client'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The envelope veodyn-api puts every refusal in (`veodyn_api/errors.py`). */
function errorBody(id: string, message: string) {
  return { error: { id, message } }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchTagVocabulary', () => {
  it('calls the same-origin sidecar path with the caller credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]))
    await fetchTagVocabulary()

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/tags',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('reads a bare array, which is the shape veodyn-api answers with', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([{ name: 'rail', count: 3 }]))
    expect(await fetchTagVocabulary()).toEqual([{ name: 'rail', count: 3 }])
  })

  it('defaults a missing count to zero rather than emitting NaN', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([{ name: 'rail' }]))
    expect(await fetchTagVocabulary()).toEqual([{ name: 'rail', count: 0 }])
  })

  it('threads the abort signal into fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]))
    const controller = new AbortController()
    await fetchTagVocabulary({ signal: controller.signal })

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/tags',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('classifies a non-ok response as an AppError carrying the status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'nope' }, 503))

    const error = await fetchTagVocabulary().catch((e: unknown) => e)
    expect(isAppError(error)).toBe(true)
    expect(isAppError(error) && error.context.status).toBe(503)
  })
})

describe('fetchRedashTagVocabulary', () => {
  it('goes through the Redash proxy for the scope asked for', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tags: [] }))
    await fetchRedashTagVocabulary('dashboards')

    expect(fetchSpy).toHaveBeenCalledWith('/api/node/dashboards/tags', expect.anything())
  })

  // Redash wraps the list in `{tags: [...]}`; the sidecar does not. Reading only
  // the bare array would silently produce an empty Redash vocabulary.
  it('unwraps the {tags: [...]} envelope Redash returns', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ tags: [{ name: 'metro', count: 5 }] })
    )
    expect(await fetchRedashTagVocabulary('queries')).toEqual([{ name: 'metro', count: 5 }])
  })

  it('reads an unexpected body as an empty vocabulary instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ unexpected: true }))
    expect(await fetchRedashTagVocabulary('queries')).toEqual([])
  })
})

describe('putObjectTags', () => {
  it('PUTs the whole set to the per-object path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ tags: ['rail', 'ridership'] })
    )
    await putObjectTags('kpi', 'k-1', ['rail', 'ridership'])

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/tags/kpi/k-1',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ tags: ['rail', 'ridership'] }),
      })
    )
  })

  it('encodes an id that is not URL safe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tags: [] }))
    await putObjectTags('dataset', 'raw/trips daily', [])

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/tags/dataset/raw%2Ftrips%20daily',
      expect.anything()
    )
  })

  // The backend normalizes and drops too, so the client renders what was kept
  // rather than what it sent.
  it('returns the stored list from the response, not the list it sent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tags: ['rail'] }))
    expect(await putObjectTags('report', 'r-1', ['  Rail ', ''])).toEqual(['rail'])
  })

  it('surfaces the reserved-prefix 422 as an AppError carrying the status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(errorBody('VEODYN_TAG_PREFIX_RESERVED', 'reserved prefix'), 422)
    )

    const error = await putObjectTags('kpi', 'k-1', ['domain:rail']).catch((e: unknown) => e)
    expect(isAppError(error)).toBe(true)
    expect(isAppError(error) && error.context.status).toBe(422)
  })

  // The status alone cannot tell these two apart: a reserved prefix and a tag
  // over the length cap are both 422 with different remediations, so the cause
  // has to survive the trip out of the client.
  it('carries the reserved-prefix cause out of the error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(errorBody('VEODYN_TAG_PREFIX_RESERVED', 'reserved prefix'), 422)
    )

    const error = await putObjectTags('kpi', 'k-1', ['domain:rail']).catch((e: unknown) => e)
    expect(tagErrorCause(error)).toBe(TagErrorCause.RESERVED_PREFIX)
  })

  it('carries the size-violation cause out of a 422 with the same status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(errorBody('VEODYN_INVALID_REQUEST', 'body.tags.0: too long'), 422)
    )

    const error = await putObjectTags('kpi', 'k-1', ['x'.repeat(101)]).catch((e: unknown) => e)
    expect(isAppError(error) && error.context.status).toBe(422)
    expect(tagErrorCause(error)).toBe(TagErrorCause.INVALID_REQUEST)
  })

  it('carries the edit-locked cause off a 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(errorBody('VEODYN_REPORT_EDIT_LOCKED', 'in review'), 409)
    )

    const error = await putObjectTags('report', 'r-1', ['rail']).catch((e: unknown) => e)
    expect(tagErrorCause(error)).toBe(TagErrorCause.REPORT_EDIT_LOCKED)
  })

  // The proxy's own 502/503 bodies put a plain string under `error`, and a
  // backend that fell over answers no JSON at all. Neither may be read as a
  // cause, or every such failure would be reported as whichever cause the
  // caller checks for first.
  it('reports no cause when the body is not the sidecar error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'tag backend unreachable' }, 502)
    )

    const error = await putObjectTags('kpi', 'k-1', ['rail']).catch((e: unknown) => e)
    expect(isAppError(error) && error.context.status).toBe(502)
    expect(tagErrorCause(error)).toBeUndefined()
  })

  it('reports no cause when the failure body is not JSON at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    )

    const error = await putObjectTags('kpi', 'k-1', ['rail']).catch((e: unknown) => e)
    expect(isAppError(error)).toBe(true)
    expect(tagErrorCause(error)).toBeUndefined()
  })

  it('lets an abort through unclassified, since it is the caller cancelling', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort)

    const error = await putObjectTags('kpi', 'k-1', []).catch((e: unknown) => e)
    expect(error).toBe(abort)
  })
})
