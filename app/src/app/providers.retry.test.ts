// Four requests went out per Feed Health load (142ms, 115ms, 104ms, 103ms) for
// a 404 that was never going to become a 200. The cost is not the requests: it
// is that the page holds a skeleton through all of them before it can say
// anything, so the slowest thing on screen is a failure the first response
// already settled.
import { describe, expect, it } from 'vitest'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { shouldRetry } from './providers'

const withStatus = (status: number) =>
  new AppError(ErrorIds.CATALOG_FETCH_FAILED, `failed (${status})`, { status })

describe('shouldRetry', () => {
  it('does not retry a settled 4xx', () => {
    expect(shouldRetry(0, withStatus(404))).toBe(false)
    expect(shouldRetry(0, withStatus(401))).toBe(false)
    expect(shouldRetry(0, withStatus(403))).toBe(false)
    expect(shouldRetry(0, withStatus(400))).toBe(false)
  })

  it('retries the two 4xx that mean "not now" rather than "not ever"', () => {
    expect(shouldRetry(0, withStatus(408))).toBe(true)
    expect(shouldRetry(0, withStatus(429))).toBe(true)
    // Still bounded.
    expect(shouldRetry(3, withStatus(429))).toBe(false)
  })

  it('keeps retrying a 5xx, which is what the default was right about', () => {
    expect(shouldRetry(0, withStatus(503))).toBe(true)
    expect(shouldRetry(2, withStatus(500))).toBe(true)
    expect(shouldRetry(3, withStatus(500))).toBe(false)
  })

  it('retries an error carrying no status at all', () => {
    // A network failure or a parse error has no verdict attached, so it gets
    // the benefit of the doubt the default gave everything.
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetry(0, new AppError(ErrorIds.CATALOG_FETCH_FAILED, 'no status'))).toBe(true)
    expect(shouldRetry(3, new TypeError('Failed to fetch'))).toBe(false)
  })
})
