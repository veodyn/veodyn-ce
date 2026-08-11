import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockQuerySnippets } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ErrorIds } from '@/lib/errorIds'
import type { AnyProposal } from '@/types/ai-create'
import { ProposalPanel } from './proposal-panel'

// An explicit registry, not whatever this build happens to install.
//
// The panel takes no registry prop: it reads FEATURES through
// src/features/proposals.ts, so this module boundary is the only seam a test
// has. Stubbing it is what makes the contributed-card case below an assertion
// about the MECHANISM (the panel mounts whatever card a contributing feature
// offers, under whatever kind that feature claims) rather than about which
// packages are on disk. A build that installs real feature packages asserts
// their own cards in its own suite.
//
// Everything the factory needs is inline and the card arrives through a
// dynamic import, because vi.mock is hoisted above every import in this file
// and a top-level binding would not exist yet when it runs.
vi.mock('@/features/generated-registry', () => ({
  FEATURES: {
    stub: {
      id: 'stub',
      nav: [],
      routes: [],
      proposals: [
        {
          kind: 'gizmo',
          parse: (raw: unknown) => raw as { kind: string },
          render: async () => {
            const { Button } = await import('@/components/ui/button')
            return {
              default: ({ proposal }: { proposal: { kind: string } }) => (
                <Button>Create {proposal.kind}</Button>
              ),
            }
          },
        },
      ],
    },
  },
}))

// AnyProposal, not Proposal: the panel holds the wire payload loosely and is
// the single place that decides whether this build draws a kind itself or
// hands it to a feature.
const PROPOSALS: Record<string, AnyProposal> = {
  query: {
    kind: 'query',
    name: 'Rides by station',
    description: '',
    sql: 'SELECT 1',
    datasetTable: 'analytics.rail_taps',
    vizChoiceId: 'table',
    vizOptions: {},
  },
  dashboard: { kind: 'dashboard', name: 'Transit health', widgets: [] },
  snippet: {
    kind: 'snippet',
    trigger: 'last7',
    snippet: 'WHERE ts >= now() - INTERVAL 7 DAY',
    description: 'Last seven days',
  },
}

beforeEach(() => {
  resetStores()
  useMockDataStore.setState({
    querySnippets: mockQuerySnippets.map((snippet) => ({ ...snippet })),
  })
})

describe('ProposalPanel', () => {
  it.each([
    ['query', 'Create query'],
    ['dashboard', 'Create dashboard'],
    ['snippet', 'Create snippet'],
  ])('mounts the %s card', async (kind, createLabel) => {
    renderWithProviders(
      <ProposalPanel
        proposal={PROPOSALS[kind]}
        onCreated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    )

    // findBy rather than getBy: these three are drawn by this tree and are
    // already there, so they resolve on the first poll, but a contributed card
    // arrives through a loader and the case below needs the wait.
    expect(await screen.findByRole('button', { name: createLabel })).toBeVisible()
  })

  // The kind is owned by nothing in this tree: it exists only on the stub
  // registry above. So this proves the whole contributed path end to end, from
  // the panel declining to switch on the kind itself, through parse, the
  // loader and Suspense, to the feature's own card on screen.
  it('mounts the card a contributing feature offers, for a kind it does not know', async () => {
    renderWithProviders(
      <ProposalPanel
        proposal={{ kind: 'gizmo', name: 'Ridership next quarter' }}
        onCreated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    )

    expect(await screen.findByRole('button', { name: 'Create gizmo' })).toBeVisible()
  })

  it('ignores a kind nothing can draw, and says why, rather than rendering a shell', async () => {
    // What a community browser receives from a service that already has the
    // pack, and what an unknown kind from a newer service looks like. Neither
    // may throw, and neither may put an empty card with a Create button on
    // screen: there is nothing behind it to create.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container } = renderWithProviders(
      <ProposalPanel
        proposal={{ kind: 'forecast', name: 'Ridership next quarter' }}
        onCreated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(logged.mock.calls.flat().join(' ')).toContain(ErrorIds.PROPOSAL_KIND_UNSUPPORTED)
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).toBeNull()
    logged.mockRestore()
  })

  it('threads its callbacks through to the card that does the writing', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const onBusyChange = vi.fn()
    renderWithProviders(
      <ProposalPanel
        proposal={PROPOSALS.snippet}
        onCreated={onCreated}
        onBusyChange={onBusyChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Create snippet' }))

    await waitFor(() =>
      expect(useMockDataStore.getState().querySnippets).toHaveLength(
        mockQuerySnippets.length + 1
      )
    )
    expect(onCreated).toHaveBeenCalledWith(null)
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })
})
