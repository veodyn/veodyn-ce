// The one link the Feed Health board makes into enterprise territory.
//
// Feeds are community and alerts are not, so the Recipients button on an armed
// feed is the single place the community board addresses a route it may not
// have. What is asserted here is that it asks first.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import type { Feed } from '@/types/feed'
import type { FeatureDescriptor } from '@/features/types'
import { ExpectedIntervalControl } from './expected-interval-control'

/**
 * A build that has the alerts package, stated rather than looked up.
 *
 * The descriptor is bare because `hasFeature` asks one question, whether the
 * key is there, so a nav row or a slot on it would only suggest this case
 * turned on something it does not. What matters is that BOTH cases below now
 * name the build they are about: driven by the installed registry, the first
 * one asserted the enterprise answer wherever the package happened to be in
 * the tree and asserted nothing at all wherever it was not.
 */
const ALERTS_INSTALLED: Record<string, FeatureDescriptor> = {
  alerts: { id: 'alerts', nav: [], routes: [] },
}

// Wrapping the real hasFeature rather than faking its answer, so the real
// lookup runs against each registry. Same pattern as
// authenticated-layout.registry.test.tsx and dashboard-view-actions.test.tsx.
let mockRegistry: Record<string, FeatureDescriptor> = ALERTS_INSTALLED
vi.mock('@/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features')>()
  return {
    ...actual,
    hasFeature: (id: string) => actual.hasFeature(id, mockRegistry),
  }
})

afterEach(() => {
  mockRegistry = ALERTS_INSTALLED
})

/** An armed feed: a declared expectation, and an alert derived from it. */
const ARMED: Feed = {
  id: 'orders',
  name: 'Orders capture',
  source: 'clickhouse',
  cadence: 'every 5 min',
  cadenceSource: 'declared',
  expectedIntervalSeconds: 300,
  alertId: 42,
  lastReceivedAt: '2026-08-09T10:00:00Z',
  status: 'fresh',
  datasetCount: 3,
}

describe('ExpectedIntervalControl', () => {
  // The alerts package is installed for this case, by the registry above and
  // not by whatever the tree holds, so the link is asserted where there really
  // is somewhere for it to go.
  it('links an armed feed to the alert that pages for it', () => {
    renderWithProviders(<ExpectedIntervalControl feed={ARMED} />)

    expect(screen.getByRole('button', { name: /who is notified/i })).toHaveAttribute(
      'href',
      '/alerts/42'
    )
  })

  it('drops the link, and nothing else, on a build with no alerts package', () => {
    mockRegistry = {}

    renderWithProviders(<ExpectedIntervalControl feed={ARMED} />)

    expect(screen.queryByRole('button', { name: /who is notified/i })).not.toBeInTheDocument()
    // The arming toggle is community and stays: the hook that arms the check
    // ships in every build, so what is lost is the page that edits recipients,
    // not the alerting itself.
    expect(screen.getByRole('button', { name: /stop alerting/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /expected interval/i })).toBeInTheDocument()
  })
})
