// Published-feed client. Calls the same-origin /api/published-feeds proxy
// routes, never the sidecar directly.
//
// The refusal body is deliberately carried into the thrown error rather than
// flattened to a status. A 422 from this endpoint names every problem with a
// column map in one message, and the form puts each on its own field.

import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type { PublishAttempt, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'

function wrapError(error: unknown): Error {
  if (isAppError(error)) return error
  // By name rather than instanceof: the abort error comes from a different
  // realm than the environment's DOMException in tests.
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.PUBLISHED_FEED_REQUEST_FAILED, 'published feed request failed', {
    cause: error instanceof Error ? error.message : String(error),
  })
}

async function refusal(res: Response, fallback: string): Promise<AppError> {
  // The sidecar's envelope is { error: { id, message } }. A proxy 502 or 503 is
  // plain JSON with an `error` string, so both shapes are read here.
  let message = fallback
  let errorId: string | undefined
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') message = body.error
    if (typeof body?.error?.message === 'string') message = body.error.message
    if (typeof body?.error?.id === 'string') errorId = body.error.id
  } catch {
    // A body that is not JSON tells us nothing the status has not.
  }
  return new AppError(ErrorIds.PUBLISHED_FEED_REQUEST_FAILED, message, { status: res.status, errorId })
}

export async function fetchPublishedFeeds(opts: { signal?: AbortSignal } = {}): Promise<PublishedFeed[]> {
  try {
    const res = await fetch('/api/published-feeds', { credentials: 'include', signal: opts.signal })
    if (!res.ok) throw await refusal(res, `published feeds fetch failed (${res.status})`)
    return (await res.json()) as PublishedFeed[]
  } catch (error) {
    throw wrapError(error)
  }
}

export async function fetchPublishedFeed(
  slug: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishedFeed | null> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: opts.signal,
    })
    if (res.status === 404) return null
    if (!res.ok) throw await refusal(res, `published feed fetch failed (${res.status})`)
    return (await res.json()) as PublishedFeed
  } catch (error) {
    throw wrapError(error)
  }
}

export async function createPublishedFeed(
  input: PublishedFeedInput,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishedFeed> {
  try {
    const res = await fetch('/api/published-feeds', {
      method: 'POST',
      credentials: 'include',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw await refusal(res, `could not publish this feed (${res.status})`)
    return (await res.json()) as PublishedFeed
  } catch (error) {
    throw wrapError(error)
  }
}

export async function updatePublishedFeed(
  slug: string,
  input: PublishedFeedInput,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishedFeed> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      credentials: 'include',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw await refusal(res, `could not save this feed (${res.status})`)
    return (await res.json()) as PublishedFeed
  } catch (error) {
    throw wrapError(error)
  }
}

export async function deletePublishedFeed(slug: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      credentials: 'include',
      signal: opts.signal,
    })
    if (!res.ok) throw await refusal(res, `could not retire this feed (${res.status})`)
  } catch (error) {
    throw wrapError(error)
  }
}

export async function fetchAttempts(
  slug: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishAttempt[]> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}/attempts`, {
      credentials: 'include',
      signal: opts.signal,
    })
    if (!res.ok) throw await refusal(res, `attempt history fetch failed (${res.status})`)
    return (await res.json()) as PublishAttempt[]
  } catch (error) {
    throw wrapError(error)
  }
}

export async function publishNow(
  slug: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishAttempt> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}/attempts`, {
      method: 'POST',
      credentials: 'include',
      signal: opts.signal,
    })
    if (!res.ok) throw await refusal(res, `could not run a publish attempt (${res.status})`)
    return (await res.json()) as PublishAttempt
  } catch (error) {
    throw wrapError(error)
  }
}
