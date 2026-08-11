import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}))
vi.mock('posthog-js', () => ({ default: posthogMock }))

import { TelemetryProvider } from './TelemetryProvider'
import type { TelemetryClientConfig } from './telemetryConfig'

const on: TelemetryClientConfig = {
  key: 'phc_x',
  host: 'https://ph.example',
  release: '1.2.3',
  commit: 'abc123',
  org: 'Veodyn',
  disabled: false,
  consoleForwarding: false,
}

/**
 * Renders and then settles the DYNAMIC import of posthog-js.
 *
 * The provider imports the SDK inside its effect rather than at module scope,
 * so `init` lands a microtask after the render rather than during it. Every
 * case awaits this, including the ones asserting init was NOT called: without
 * the flush those would pass against a provider that initialises unconditionally
 * a tick later, which is the exact regression they exist to catch.
 */
async function renderWith(config: TelemetryClientConfig) {
  const result = render(
    <TelemetryProvider config={config}>
      <p>content</p>
    </TelemetryProvider>,
  )
  await act(async () => {})
  return result
}

beforeEach(() => vi.clearAllMocks())

describe('TelemetryProvider', () => {
  it('always renders its children', async () => {
    await renderWith({ ...on, key: '' })
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('does not initialise posthog without a key', async () => {
    await renderWith({ ...on, key: '' })
    expect(posthogMock.init).not.toHaveBeenCalled()
  })

  it('does not initialise posthog without a host', async () => {
    await renderWith({ ...on, host: '' })
    expect(posthogMock.init).not.toHaveBeenCalled()
  })

  it('does not initialise posthog when disabled', async () => {
    await renderWith({ ...on, disabled: true })
    expect(posthogMock.init).not.toHaveBeenCalled()
  })

  it('does not initialise synchronously, which is what makes the import dynamic', async () => {
    // The distinguishing assertion, and the reason the others are not enough.
    // Every other case in this file awaits the flush first, so all of them
    // would still pass against a static `import posthog from 'posthog-js'` with
    // a synchronous effect body: the mocked init is called either way, just
    // sooner. Only the state BEFORE the microtask queue drains tells the two
    // apart, and keeping the SDK out of the synchronous path is the entire
    // point of the change (227 KB off every route's critical path).
    render(
      <TelemetryProvider config={on}>
        <p>content</p>
      </TelemetryProvider>,
    )
    expect(posthogMock.init).not.toHaveBeenCalled()

    await act(async () => {})
    expect(posthogMock.init).toHaveBeenCalled()
  })

  it('initialises with the masked recording config', async () => {
    await renderWith(on)
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_x',
      expect.objectContaining({
        api_host: 'https://ph.example',
        person_profiles: 'identified_only',
        session_recording: expect.objectContaining({ maskAllInputs: true }),
      }),
    )
  })

  it('registers app, release, commit and org as super-properties', async () => {
    await renderWith(on)
    const loaded = posthogMock.init.mock.calls[0][1].loaded
    loaded(posthogMock)
    expect(posthogMock.register).toHaveBeenCalledWith({
      app: 'veodyn',
      release: '1.2.3',
      commit: 'abc123',
      org: 'Veodyn',
    })
  })

  it('sends an event through the scrub before it leaves', async () => {
    await renderWith(on)
    const beforeSend = posthogMock.init.mock.calls[0][1].before_send
    const scrubbed = beforeSend({ properties: { route: '/a', customerName: 'Acme' } })
    expect(scrubbed.properties).toEqual({ route: '/a', customerName: '[redacted]' })
  })
})
