// Data Catalog client service. Calls the same-origin /api/catalog and
// /api/domains/[key] proxy routes (never the backend directly, see
// ../../app/api/catalog/route.ts and ../../app/api/domains/[key]/route.ts).
//
// The contract has no per-id dataset endpoint: fetchDataset derives one
// dataset from the full catalog list.

import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type { Dataset, DomainHub } from '@/types/catalog'
import type { Feed } from '@/types/feed'

// Any error thrown out of a fetch + JSON parse pair (network failure,
// malformed body) becomes a classified AppError so callers never see a raw
// TypeError/SyntaxError. AppErrors and aborts pass through unchanged: an
// AppError is already classified, and an abort is a caller-initiated
// cancellation, not a backend outage.
function wrapCatalogError(error: unknown): Error {
  if (isAppError(error)) return error
  // Checked by `name` rather than `instanceof DOMException`: the abort error
  // thrown by fetch comes from a different realm than the environment's
  // DOMException global in tests (jsdom vs. Node's fetch implementation), so
  // an instanceof check would miss it there.
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.CATALOG_FETCH_FAILED, 'catalog request failed', {
    cause: error instanceof Error ? error.message : String(error),
  })
}

export async function fetchCatalog(
  opts: { q?: string; signal?: AbortSignal } = {}
): Promise<Dataset[]> {
  const url = opts.q ? `/api/catalog?q=${encodeURIComponent(opts.q)}` : '/api/catalog'
  try {
    const res = await fetch(url, { credentials: 'include', signal: opts.signal })
    if (!res.ok) {
      throw new AppError(ErrorIds.CATALOG_FETCH_FAILED, `catalog fetch failed (${res.status})`, {
        status: res.status,
      })
    }
    return (await res.json()) as Dataset[]
  } catch (error) {
    throw wrapCatalogError(error)
  }
}

export async function fetchDataset(
  id: string,
  opts: { signal?: AbortSignal } = {}
): Promise<Dataset | null> {
  const all = await fetchCatalog({ signal: opts.signal })
  return all.find((d) => d.id === id) ?? null
}

export async function fetchDomainHubs(
  opts: { signal?: AbortSignal } = {}
): Promise<DomainHub[]> {
  try {
    const res = await fetch('/api/domains', { credentials: 'include', signal: opts.signal })
    if (!res.ok) {
      throw new AppError(
        ErrorIds.CATALOG_FETCH_FAILED,
        `domain hubs fetch failed (${res.status})`,
        { status: res.status }
      )
    }
    return (await res.json()) as DomainHub[]
  } catch (error) {
    throw wrapCatalogError(error)
  }
}

export async function fetchDomainHub(
  key: string,
  opts: { signal?: AbortSignal } = {}
): Promise<DomainHub | null> {
  try {
    const res = await fetch(`/api/domains/${encodeURIComponent(key)}`, {
      credentials: 'include',
      signal: opts.signal,
    })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new AppError(
        ErrorIds.CATALOG_FETCH_FAILED,
        `domain hub fetch failed (${res.status})`,
        { status: res.status }
      )
    }
    return (await res.json()) as DomainHub
  } catch (error) {
    throw wrapCatalogError(error)
  }
}

/**
 * Declare how often a feed should deliver, or clear the declaration with null.
 *
 * The interval is what gives lib/feed-status.ts a period to age against. With
 * none, deriveFeedStatus stops aging the feed and repeats whatever the upstream
 * last claimed, which is the state every feed on the instance was in.
 */
export async function setFeedExpectation(
  feedId: string,
  expectedIntervalSeconds: number | null,
  opts: { signal?: AbortSignal } = {}
): Promise<void> {
  try {
    const res = await fetch(`/api/feeds?feedId=${encodeURIComponent(feedId)}`, {
      method: 'PUT',
      credentials: 'include',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedIntervalSeconds }),
    })
    if (!res.ok) {
      throw new AppError(ErrorIds.CATALOG_FETCH_FAILED, `feed expectation failed (${res.status})`, {
        status: res.status,
      })
    }
  } catch (error) {
    throw wrapCatalogError(error)
  }
}

/** Arm or disarm the derived late-alert on a feed. */
export async function setFeedAlert(
  feedId: string,
  armed: boolean,
  opts: { signal?: AbortSignal } = {}
): Promise<void> {
  try {
    const res = await fetch(`/api/feeds?feedId=${encodeURIComponent(feedId)}&resource=alert`, {
      method: 'PUT',
      credentials: 'include',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ armed }),
    })
    if (!res.ok) {
      throw new AppError(ErrorIds.CATALOG_FETCH_FAILED, `feed alert failed (${res.status})`, {
        status: res.status,
      })
    }
  } catch (error) {
    throw wrapCatalogError(error)
  }
}

export async function fetchFeeds(opts: { signal?: AbortSignal } = {}): Promise<Feed[]> {
  try {
    const res = await fetch('/api/feeds', { credentials: 'include', signal: opts.signal })
    if (!res.ok) {
      throw new AppError(ErrorIds.CATALOG_FETCH_FAILED, `feeds fetch failed (${res.status})`, {
        status: res.status,
      })
    }
    return (await res.json()) as Feed[]
  } catch (error) {
    throw wrapCatalogError(error)
  }
}
