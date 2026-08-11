// The query cache belongs to an identity, and this provider outlives a sign
// out. Every query key says WHAT it is and never who asked, so a cache that
// survives an identity change hands the next person the previous person's rows.
// The mock identity switcher made that a two-click path.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import type { TelemetryClientConfig } from '@/lib/observability/telemetryConfig'
import { useAuthStore } from '@/stores/auth-store'
import { Providers } from './providers'

const config = toClientConfig(NEUTRAL_CONFIG)

// An empty key is the off switch, so these tests never reach posthog. What is
// under test here is the cache lifecycle, not telemetry.
const telemetryOff: TelemetryClientConfig = {
  key: '',
  host: '',
  release: '',
  commit: '',
  org: '',
  disabled: false,
  consoleForwarding: false,
}

function signInAs(id: number) {
  useAuthStore.setState({
    currentUser: { id, name: `User ${id}` } as never,
    isAuthenticated: true,
    isLoading: false,
  })
}

function signOut() {
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
}

afterEach(() => {
  signOut()
  vi.restoreAllMocks()
})

/** Reads one shared query key, so two identities collide on it exactly as the
 * real list pages do. */
function SecretList({ fetcher }: { fetcher: () => Promise<string> }) {
  const { data } = useQuery({ queryKey: ['queries'], queryFn: fetcher })
  return <div data-testid="rows">{data ?? 'loading'}</div>
}

describe('the query cache across an identity change', () => {
  it('does not serve one account the rows fetched for another', async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("alice's queries")
      .mockResolvedValueOnce("bob's queries")

    signInAs(1)
    const { rerender } = render(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <SecretList fetcher={fetcher} />
      </Providers>
    )
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent("alice's queries"))

    // Bob signs in in the same tab, well inside the 30s staleTime.
    signInAs(2)
    rerender(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <SecretList fetcher={fetcher} />
      </Providers>
    )

    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent("bob's queries"))
    expect(screen.queryByText("alice's queries")).not.toBeInTheDocument()
    // Refetched rather than read from the surviving cache.
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('drops the cache on sign-out, not merely on the next sign-in', async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("alice's queries")
      .mockResolvedValueOnce("alice's queries again")

    signInAs(1)
    const { rerender } = render(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <SecretList fetcher={fetcher} />
      </Providers>
    )
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent("alice's queries"))

    signOut()
    rerender(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <SecretList fetcher={fetcher} />
      </Providers>
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })

  it('keeps the cache while the identity is unchanged', async () => {
    const fetcher = vi.fn<() => Promise<string>>().mockResolvedValue("alice's queries")

    signInAs(1)
    const { rerender } = render(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <SecretList fetcher={fetcher} />
      </Providers>
    )
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent("alice's queries"))

    rerender(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <SecretList fetcher={fetcher} />
      </Providers>
    )

    // A re-render is not an identity change, and throwing the cache away on
    // every one of them would make the app refetch constantly.
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

// Counts mounts of Fragile below. A remount is the whole question here, and
// component state is what a remount destroys, so the component reports the
// state it was born with rather than a live reading of this counter.
let mounts = 0

/** Reports which mount it is. A survivor keeps its number; a rebuild gets a new one. */
function Fragile() {
  const [instance] = useState(() => (mounts += 1))
  return <div data-testid="instance">{instance}</div>
}

describe('what survives the transition into a session', () => {
  beforeEach(() => {
    mounts = 0
  })

  it('does not tear down the tree when an anonymous visitor signs in', async () => {
    signOut()

    const { rerender } = render(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <Fragile />
      </Providers>
    )
    await waitFor(() => expect(screen.getByTestId('instance')).toHaveTextContent('1'))

    // The moment the session lands. Nothing is being left behind here: an
    // anonymous visitor has no account data to carry forward, and the tree
    // being rebuilt is the sign-in card itself, which is mid-handover to the
    // router. Rebuilding it there is what made a working sign-in look dead.
    signInAs(1)
    rerender(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <Fragile />
      </Providers>
    )

    expect(screen.getByTestId('instance')).toHaveTextContent('1')
    expect(mounts).toBe(1)
  })

  it('still tears it down when one account replaces another', async () => {
    signInAs(1)

    const { rerender } = render(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <Fragile />
      </Providers>
    )
    await waitFor(() => expect(screen.getByTestId('instance')).toHaveTextContent('1'))

    signInAs(2)
    rerender(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <Fragile />
      </Providers>
    )

    // A half-filled form belongs to whoever was typing in it, not to whoever
    // signs in next.
    await waitFor(() => expect(screen.getByTestId('instance')).toHaveTextContent('2'))
  })

  it('still tears it down on the way out', async () => {
    signInAs(1)

    const { rerender } = render(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <Fragile />
      </Providers>
    )
    await waitFor(() => expect(screen.getByTestId('instance')).toHaveTextContent('1'))

    signOut()
    rerender(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <Fragile />
      </Providers>
    )

    await waitFor(() => expect(screen.getByTestId('instance')).toHaveTextContent('2'))
  })
})
