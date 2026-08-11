// What the proposal seam owes a build that is missing the feature a turn
// converged on.
//
// The case this seam exists for is the second one: a proposal of a kind nothing
// installed can render is IGNORED with a logged reason. Not thrown, and not
// drawn as a card with no fields in it. A community browser in front of a
// service that already has the pack is an ordinary state during a rolling
// deploy, and the chat has to stay usable through it.
//
// Every case builds its own registry object rather than mocking the module,
// the pattern featureList, assembleSearchSources and Slot all follow. Here it
// also keeps the lazy-card cache honest: the cache is keyed on registry
// identity, so one case cannot answer for the next.
import { describe, expect, it, vi } from 'vitest'
import { ErrorIds } from '@/lib/errorIds'
import {
  contributedProposalKinds,
  proposalContributionFor,
  resolveContributedProposal,
} from './proposals'
import type { FeatureDescriptor, ProposalContribution } from './types'

function featureWith(id: string, proposals: ProposalContribution[]): FeatureDescriptor {
  return { id, nav: [], routes: [], proposals }
}

/** A contribution that claims `kind` and accepts anything of it. */
function claims(kind: string, label = `${kind} card`): ProposalContribution {
  return {
    kind,
    parse: (raw) => (typeof raw === 'object' && raw !== null ? (raw as { kind: string }) : null),
    render: async () => ({ default: () => label as unknown as null }),
  }
}

function captureErrors() {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  return {
    text: () => spy.mock.calls.flat().join(' '),
    restore: () => spy.mockRestore(),
  }
}

describe('resolveContributedProposal', () => {
  it('ignores a kind no installed feature claims, with the id in the log', () => {
    const log = captureErrors()
    const registry = { alerts: featureWith('alerts', [claims('alert')]) }

    const resolved = resolveContributedProposal({ kind: 'kpi', name: 'Punctuality' }, registry)

    expect(resolved).toBeNull()
    expect(log.text()).toContain(ErrorIds.PROPOSAL_KIND_UNSUPPORTED)
    // The log names what arrived and what this build could have drawn, because
    // "which half is behind" is the only question worth asking about it.
    expect(log.text()).toContain('kpi')
    expect(log.text()).toContain('alert')
    log.restore()
  })

  it('does not throw on an empty registry, which is the community build', () => {
    const log = captureErrors()

    expect(() => resolveContributedProposal({ kind: 'kpi' }, {})).not.toThrow()
    expect(resolveContributedProposal({ kind: 'report' }, {})).toBeNull()
    expect(contributedProposalKinds({})).toEqual([])
    log.restore()
  })

  it('enters no loader for a kind nothing claims', () => {
    const log = captureErrors()
    // The loader belongs to a DIFFERENT kind in the same registry. A resolver
    // that entered every contribution's loader looking for a match would trip
    // this even though it returned the right answer.
    const render = vi.fn(async () => ({ default: () => null }))
    const registry = {
      alerts: featureWith('alerts', [{ ...claims('alert'), render }]),
    }

    expect(resolveContributedProposal({ kind: 'kpi' }, registry)).toBeNull()
    expect(render).not.toHaveBeenCalled()
    log.restore()
  })

  it('resolves the contribution that claims the kind, and enters no other', () => {
    const registry = {
      kpis: featureWith('kpis', [claims('kpi')]),
      reports: featureWith('reports', [claims('report')]),
    }

    const resolved = resolveContributedProposal({ kind: 'report', outline: {} }, registry)

    expect(resolved).not.toBeNull()
    expect(resolved?.proposal.kind).toBe('report')
    expect(contributedProposalKinds(registry)).toEqual(['kpi', 'report'])
  })

  it('returns the SAME lazy card for a kind on every call, so a re-render does not reload it', () => {
    const registry = { kpis: featureWith('kpis', [claims('kpi')]) }

    const first = resolveContributedProposal({ kind: 'kpi' }, registry)
    const second = resolveContributedProposal({ kind: 'kpi' }, registry)

    expect(first?.Card).toBe(second?.Card)
  })

  it('ignores a payload the owning feature refuses, and says so', () => {
    // parse is the pre-load gate: a kpi proposal with nothing in it is this
    // feature's kind and still not something its card can open. What must not
    // happen is fetching the chunk and letting the card decide, because then a
    // build pays for a card it is going to throw away.
    const log = captureErrors()
    const render = vi.fn(async () => ({ default: () => null }))
    const registry = {
      kpis: featureWith('kpis', [
        {
          kind: 'kpi',
          parse: (raw) =>
            typeof (raw as { name?: unknown }).name === 'string' ? (raw as { kind: string }) : null,
          render,
        },
      ]),
    }

    expect(resolveContributedProposal({ kind: 'kpi' }, registry)).toBeNull()
    expect(render).not.toHaveBeenCalled()
    expect(log.text()).toContain(ErrorIds.PROPOSAL_KIND_UNSUPPORTED)
    log.restore()
  })
})

describe('proposalContributionFor', () => {
  it('takes the first feature that claims a kind rather than failing over a duplicate', () => {
    // Two features claiming one kind is a packaging mistake. A chat that
    // refuses to render over it is worse than one that picks the first.
    const registry = {
      alerts: featureWith('alerts', [claims('kpi', 'from alerts')]),
      kpis: featureWith('kpis', [claims('kpi', 'from kpis')]),
    }

    expect(proposalContributionFor('kpi', registry)).toBe(registry.alerts.proposals?.[0])
  })

  it('is undefined for a feature that contributes no proposals at all', () => {
    expect(proposalContributionFor('kpi', { wall: { id: 'wall', nav: [], routes: [] } })).toBeUndefined()
  })
})
