'use client'

// The one component the chat shell mounts once a proposal arrives. It is a
// switch and nothing else: each kind's fields, validation and create sequence
// belong to its own card, and the discriminated union means a new kind cannot
// be added to the contract without this failing to compile.
//
// Two dispatches, not one. The three kinds the community tree draws itself go
// through the switch below and are checked exhaustively. Anything else is a
// kind an installed feature owns, and goes to the registry
// (src/features/proposals.ts), which either resolves a contributed card or logs
// why it will not: a proposal this build cannot draw is IGNORED rather than
// half-drawn or thrown, because a community browser talking to a service that
// has the pack is an ordinary state during a rolling deploy, not a fault.
import { Suspense, type ReactElement, type ReactNode } from 'react'
import { resolveContributedProposal } from '@/features/proposals'
import type { AnyProposal, FeatureProposal } from '@/types/ai-create'
import { DashboardProposalCard } from './dashboard-proposal'
import { DashboardEditProposalCard } from './dashboard-edit-proposal'
import { isCommunityProposal } from './proposal-model'
import { QueryProposalCard } from './query-proposal'
import { SnippetProposalCard } from './snippet-proposal'

export interface ProposalPanelProps {
  proposal: AnyProposal
  /** Called once the object exists, with where to send the user (null = stay). */
  onCreated: (href: string | null) => void
  /** True while a create is in flight, so the shell can lock its composer. */
  onBusyChange: (busy: boolean) => void
  /**
   * The dashboard being edited, when this conversation is an edit. Absent for
   * a creation, which is what tells the two dashboard cards apart.
   */
  targetDashboardId?: number
  /**
   * A revision of this proposal is in flight, so what the card shows is already
   * out of date. Creating from it writes the thing the user just asked to
   * change, and the reply that would have corrected it never lands.
   */
  superseded?: boolean
}

type Handlers = Pick<ProposalPanelProps, 'onCreated' | 'onBusyChange'>

/**
 * A card an installed feature supplies, or nothing at all.
 *
 * No Suspense fallback beyond null: the chunk arrives in a frame or two and a
 * skeleton where a form is about to be would move the composer under the
 * user's cursor twice. Nothing is lost by showing nothing, which is also what
 * this renders when the registry has no card for the kind.
 */
function ContributedCard({
  proposal,
  onCreated,
  onBusyChange,
}: Handlers & { proposal: FeatureProposal }): ReactNode {
  const resolved = resolveContributedProposal(proposal)
  if (!resolved) return null
  const { Card } = resolved
  return (
    <Suspense fallback={null}>
      <Card proposal={resolved.proposal} onCreated={onCreated} onBusyChange={onBusyChange} />
    </Suspense>
  )
}

function card(proposal: AnyProposal, handlers: Handlers, targetDashboardId?: number): ReactNode {
  if (!isCommunityProposal(proposal)) return <ContributedCard proposal={proposal} {...handlers} />

  switch (proposal.kind) {
    case 'query':
      return <QueryProposalCard proposal={proposal} {...handlers} />
    case 'dashboard':
      // The same proposal shape means two different things depending on
      // whether there is a dashboard to apply it to: a new dashboard, or the
      // end state of one that exists.
      return targetDashboardId == null ? (
        <DashboardProposalCard proposal={proposal} {...handlers} />
      ) : (
        <DashboardEditProposalCard
          proposal={proposal}
          dashboardId={targetDashboardId}
          {...handlers}
        />
      )
    case 'snippet':
      return <SnippetProposalCard proposal={proposal} {...handlers} />
  }
}

export function ProposalPanel({
  proposal,
  onCreated,
  onBusyChange,
  targetDashboardId,
  superseded = false,
}: ProposalPanelProps): ReactElement {
  const body = card(proposal, { onCreated, onBusyChange }, targetDashboardId)
  if (!superseded) return <>{body}</>

  // A fieldset rather than a disabled prop threaded through five cards: it
  // disables every control inside it, including the Create button, whatever
  // each card is made of. The rule is about the card as a whole being stale,
  // not about any one control.
  return (
    <fieldset disabled className="min-w-0 border-0 p-0" aria-describedby={SUPERSEDED_ID}>
      {body}
      <p id={SUPERSEDED_ID} className="pt-2 text-pretty text-xs text-muted-foreground">
        Waiting for the change you asked for. This card is what was proposed
        before it.
      </p>
    </fieldset>
  )
}

const SUPERSEDED_ID = 'proposal-superseded-note'
