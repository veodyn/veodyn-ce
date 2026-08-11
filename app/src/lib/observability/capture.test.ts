import { beforeEach, describe, expect, it, vi } from 'vitest'

import { capture, captureException, identifyUser, markReady, resetIdentity } from './capture'

// A plain double handed to markReady, rather than a vi.mock of 'posthog-js'.
// capture.ts no longer imports the SDK at all: TelemetryProvider imports it
// dynamically and injects the instance, which is what keeps 227 KB off every
// route's critical path. Mocking the module here would have kept passing while
// testing a seam the app no longer uses.
const posthogMock = {
  capture: vi.fn(),
  captureException: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  markReady(null)
  resetIdentity()
})

describe('capture', () => {
  it('does nothing before telemetry is ready', () => {
    capture('app_error_shown', { route: '/a' })
    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('scrubs properties on the way out', () => {
    markReady(posthogMock)
    capture('app_error_shown', { route: '/a', customerName: 'Acme' })
    expect(posthogMock.capture).toHaveBeenCalledWith('app_error_shown', {
      route: '/a',
      customerName: '[redacted]',
    })
  })

  it('swallows an SDK throw so telemetry never breaks a render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    posthogMock.capture.mockImplementationOnce(() => {
      throw new Error('posthog exploded')
    })
    markReady(posthogMock)
    expect(() => capture('app_error_shown')).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('the window while posthog-js is being imported', () => {
  // The window exists BECAUSE of the dynamic import: while the SDK was a static
  // import, init ran synchronously in the provider's effect and there was
  // effectively no unready period. Boot is when the events worth having are
  // fired, so this is the part of the bundle win that had to be paid for.
  it('replays what was captured once the SDK arrives', () => {
    capture('app_error_shown', { route: '/a' })
    captureException(new Error('boom'), { route: '/a' })
    expect(posthogMock.capture).not.toHaveBeenCalled()

    markReady(posthogMock)

    expect(posthogMock.capture).toHaveBeenCalledWith('app_error_shown', { route: '/a' })
    expect(posthogMock.captureException).toHaveBeenCalledWith(expect.any(Error), { route: '/a' })
  })

  it('replays the identity before the events, so nothing is attributed to nobody', () => {
    const order: string[] = []
    posthogMock.identify.mockImplementation(() => void order.push('identify'))
    posthogMock.capture.mockImplementation(() => void order.push('capture'))

    identifyUser({ id: '7', name: 'Ada', email: 'ada@example.test' })
    capture('app_error_shown')
    markReady(posthogMock)

    expect(order).toEqual(['identify', 'capture'])
  })

  it('scrubs on the way in, not on the way out', () => {
    const props: Record<string, unknown> = { route: '/a', customerName: 'Acme' }
    capture('app_error_shown', props)
    // Holding the caller's object until replay is how a value that was
    // sensitive at capture time leaks later, so the buffer must already hold
    // the scrubbed copy rather than a reference to this.
    props.customerName = 'mutated after the call'

    markReady(posthogMock)

    expect(posthogMock.capture).toHaveBeenCalledWith('app_error_shown', {
      route: '/a',
      customerName: '[redacted]',
    })
  })

  it('drops the buffer when telemetry stands down instead of replaying it later', () => {
    capture('app_error_shown')
    markReady(null)
    markReady(posthogMock)

    expect(posthogMock.capture).not.toHaveBeenCalled()
  })

  it('keeps the buffer bounded, and keeps the most recent events', () => {
    for (let i = 0; i < 60; i++) capture('app_error_shown', { route: `/${i}` })
    markReady(posthogMock)

    expect(posthogMock.capture).toHaveBeenCalledTimes(50)
    // Oldest-first eviction: the window is milliseconds, so if it ever fills,
    // what just happened is more informative than what happened first.
    expect(posthogMock.capture).toHaveBeenCalledWith('app_error_shown', { route: '/59' })
    expect(posthogMock.capture).not.toHaveBeenCalledWith('app_error_shown', { route: '/0' })
  })
})

describe('captureException', () => {
  it('forwards the error and scrubbed context once ready', () => {
    markReady(posthogMock)
    const err = new Error('boom')
    captureException(err, { route: '/a', digest: 'abc' })
    expect(posthogMock.captureException).toHaveBeenCalledWith(err, { route: '/a', digest: 'abc' })
  })

  it('does nothing before telemetry is ready', () => {
    captureException(new Error('boom'))
    expect(posthogMock.captureException).not.toHaveBeenCalled()
  })
})

describe('identity', () => {
  it('replays an identify that arrived before telemetry was ready', () => {
    identifyUser({ id: '7', name: 'Ada', email: 'ada@example.test' })
    expect(posthogMock.identify).not.toHaveBeenCalled()
    markReady(posthogMock)
    expect(posthogMock.identify).toHaveBeenCalledWith('7', {
      name: 'Ada',
      email: 'ada@example.test',
    })
  })

  it('does not re-identify a user who signed out before telemetry was ready', () => {
    identifyUser({ id: '7', name: 'Ada', email: 'ada@example.test' })
    resetIdentity()
    markReady(posthogMock)
    expect(posthogMock.identify).not.toHaveBeenCalled()
  })

  it('resets posthog when signing out while ready', () => {
    markReady(posthogMock)
    resetIdentity()
    expect(posthogMock.reset).toHaveBeenCalled()
  })
})
