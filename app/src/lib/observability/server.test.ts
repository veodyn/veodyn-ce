import { beforeEach, describe, expect, it, vi } from 'vitest'

const phMock = vi.hoisted(() => ({ captureException: vi.fn() }))
// A class, not an arrow: server.ts calls `new PostHog(...)` and an arrow
// function is not a constructor.
vi.mock('posthog-node', () => ({
  PostHog: class {
    captureException = phMock.captureException
  },
}))
vi.mock('@/lib/env', () => ({
  env: { POSTHOG_KEY: 'phc_x', POSTHOG_HOST: 'https://ph.example', DISABLE_TELEMETRY: false },
}))

import { AppError, ErrorIds } from '@/lib/errorIds'
import { captureServerError, resetServerClient } from './server'

beforeEach(() => {
  vi.clearAllMocks()
  resetServerClient()
})

describe('captureServerError', () => {
  it('captures with the actor id as distinct_id', () => {
    captureServerError('7', new Error('boom'), { route: '/api/kpis' })
    expect(phMock.captureException).toHaveBeenCalledWith(expect.any(Error), '7', {
      route: '/api/kpis',
      errorId: '',
    })
  })

  it('falls back to anonymous with no actor', () => {
    captureServerError(null, new Error('boom'))
    expect(phMock.captureException).toHaveBeenCalledWith(expect.any(Error), 'anonymous', {
      errorId: '',
    })
  })

  it('carries the errorId from an AppError', () => {
    captureServerError('7', new AppError(ErrorIds.UP_TIMEOUT, 'slow'), { route: '/api/captures' })
    expect(phMock.captureException).toHaveBeenCalledWith(expect.any(AppError), '7', {
      route: '/api/captures',
      errorId: 'E_UP_002',
    })
  })

  it('scrubs properties, so an upstream payload cannot ride along', () => {
    captureServerError('7', new Error('boom'), { customerName: 'Acme' })
    expect(phMock.captureException).toHaveBeenCalledWith(expect.any(Error), '7', {
      customerName: '[redacted]',
      errorId: '',
    })
  })

  it('does nothing once the request is aborted', () => {
    const controller = new AbortController()
    controller.abort()
    captureServerError('7', new Error('boom'), {}, controller.signal)
    expect(phMock.captureException).not.toHaveBeenCalled()
  })

  it('swallows an SDK throw so a route handler never fails on telemetry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    phMock.captureException.mockImplementationOnce(() => {
      throw new Error('posthog exploded')
    })
    expect(() => captureServerError('7', new Error('boom'))).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
