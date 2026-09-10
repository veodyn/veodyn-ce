import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { NEUTRAL_CONFIG, toClientConfig, type VeodynConfig } from '@/lib/config-schema'
import type { TelemetryClientConfig } from '@/lib/observability/telemetryConfig'
import { identifyUser } from '@/lib/observability/capture'
import { useAuthStore } from '@/stores/auth-store'
import { Providers } from './providers'

vi.mock('@/lib/observability/capture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/observability/capture')>()),
  identifyUser: vi.fn(),
  resetIdentity: vi.fn(),
}))

const telemetryOff: TelemetryClientConfig = {
  key: '',
  host: '',
  release: '',
  commit: '',
  org: '',
  disabled: false,
  consoleForwarding: false,
}

const PERSONAS: VeodynConfig['demo']['personas'] = [
  {
    id: 'operations',
    label: 'Operations lead',
    email: 'demo-ops@example.com',
    description: null,
  },
]

function configWith(personas: VeodynConfig['demo']['personas']) {
  return toClientConfig({ ...NEUTRAL_CONFIG, demo: { personas } })
}

function signInAs(id: number) {
  useAuthStore.setState({
    currentUser: { id, name: `User ${id}`, email: `user${id}@example.com` } as never,
    isAuthenticated: true,
    isLoading: false,
  })
}

afterEach(() => {
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
  vi.mocked(identifyUser).mockClear()
})

describe('identity on an instance whose accounts are shared demo personas', () => {
  it('does not attach a posthog person, so visitors do not merge into one', async () => {
    signInAs(7)

    render(
      <Providers config={configWith(PERSONAS)} telemetry={telemetryOff} initialSession={null}>
        <div />
      </Providers>
    )

    await waitFor(() => expect(vi.mocked(identifyUser)).not.toHaveBeenCalled())
  })

  it('attaches one where the accounts are real, which is every other instance', async () => {
    signInAs(7)

    render(
      <Providers config={configWith([])} telemetry={telemetryOff} initialSession={null}>
        <div />
      </Providers>
    )

    await waitFor(() => expect(vi.mocked(identifyUser)).toHaveBeenCalledWith({
      id: '7',
      name: 'User 7',
      email: 'user7@example.com',
    }))
  })
})
