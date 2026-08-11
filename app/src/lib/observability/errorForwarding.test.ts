import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureMock = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('./capture', () => ({
  captureException: captureMock.captureException,
  currentRoute: () => '/dashboards/5',
}))

import { forwardBoundaryError, installGlobalHandlers } from './errorForwarding'

beforeEach(() => vi.clearAllMocks())

describe('forwardBoundaryError', () => {
  it('sends the route and digest a Next error boundary receives', () => {
    const err = new Error('boom')
    forwardBoundaryError(err, { route: '/kpis', digest: 'd1' })
    expect(captureMock.captureException).toHaveBeenCalledWith(err, {
      route: '/kpis',
      digest: 'd1',
    })
  })

  it('defaults a missing digest to an empty string', () => {
    forwardBoundaryError(new Error('boom'), { route: '/kpis' })
    expect(captureMock.captureException).toHaveBeenCalledWith(expect.any(Error), {
      route: '/kpis',
      digest: '',
    })
  })
})

describe('installGlobalHandlers', () => {
  it('forwards an unhandled rejection', () => {
    const uninstall = installGlobalHandlers()
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('nope') }),
    )
    expect(captureMock.captureException).toHaveBeenCalledWith(expect.any(Error), {
      route: '/dashboards/5',
      kind: 'unhandledrejection',
    })
    uninstall()
  })

  it('forwards a window error', () => {
    const uninstall = installGlobalHandlers()
    window.dispatchEvent(Object.assign(new Event('error'), { error: new Error('nope') }))
    expect(captureMock.captureException).toHaveBeenCalledWith(expect.any(Error), {
      route: '/dashboards/5',
      kind: 'window.error',
    })
    uninstall()
  })

  it('stops forwarding once uninstalled', () => {
    installGlobalHandlers()()
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('nope') }),
    )
    expect(captureMock.captureException).not.toHaveBeenCalled()
  })
})
