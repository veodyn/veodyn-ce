// The registry seam for Create-with-AI proposal cards.
//
// The chat's conversation contract is community and names five kinds; two of
// them, `kpi` and `report`, are created by code that ships with a feature. So a
// community build can converge on a proposed KPI and have nothing to draw:
// `schemas/ai_create.py` is in the community service, and a rolling deploy puts
// a browser on the old bundle in front of a service that already has the pack.
//
// The turn is then IGNORED, with a reason in the log. Not thrown (the chat
// stays usable) and not drawn half-way (a card with blank fields reads as a bug
// in the model rather than a missing feature).
//
// Like features/search-sources.ts and features/slots.tsx, this module is NOT
// re-exported from features/index.ts: that entry point is reached from the
// server root layout through src/lib/theme-preference.ts, and this one imports
// React and the error registry.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { AnyProposal, FeatureProposal } from '@/types/ai-create'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { ProposalCardProps, ProposalContribution } from './proposal-types'
import type { FeatureDescriptor } from './types'

type Card = LazyExoticComponent<ComponentType<ProposalCardProps>>

/**
 * Lazy cards, keyed on the registry object and then the proposal kind.
 *
 * React.lazy must not be called during render without a stable identity, or
 * every render mounts a new component and the load restarts. Keying on registry
 * identity, the same way slots.tsx does, gives the shipped FEATURES one entry
 * and each test's stub registry its own, with no reset hook to call.
 */
const cards = new WeakMap<Record<string, FeatureDescriptor>, Map<string, Card>>()

/**
 * The first installed feature that claims this kind, in featureList order.
 * First wins rather than an error, for the reason slots.tsx gives: two features
 * claiming one kind is a packaging mistake, and a chat that refuses to render
 * over it is worse than one that picks the first.
 */
export function proposalContributionFor(
  kind: string,
  registry: Record<string, FeatureDescriptor> = FEATURES
): ProposalContribution | undefined {
  for (const feature of featureList(registry)) {
    const contribution = feature.proposals?.find((entry) => entry.kind === kind)
    if (contribution) return contribution
  }
  return undefined
}

/** Every proposal kind the installed features can draw a card for. */
export function contributedProposalKinds(
  registry: Record<string, FeatureDescriptor> = FEATURES
): string[] {
  return featureList(registry).flatMap((feature) =>
    (feature.proposals ?? []).map((entry) => entry.kind)
  )
}

function ignore(reason: string, context: Record<string, unknown>): null {
  console.error(new AppError(ErrorIds.PROPOSAL_KIND_UNSUPPORTED, reason, context).toLogLine())
  return null
}

function cardFor(
  contribution: ProposalContribution,
  registry: Record<string, FeatureDescriptor>
): Card {
  let byKind = cards.get(registry)
  if (!byKind) {
    byKind = new Map()
    cards.set(registry, byKind)
  }
  const cached = byKind.get(contribution.kind)
  if (cached) return cached

  const card = lazy(async () => {
    try {
      return await contribution.render()
    } catch (reason) {
      // Caught INSIDE the lazy's own async function, not by an error boundary
      // above it: React.lazy rethrows a rejected loader during render, which
      // would take the whole chat dialog down. A card this build cannot fetch
      // degrades to no card, as an unregistered kind already does.
      const error = new AppError(
        ErrorIds.PROPOSAL_CARD_UNAVAILABLE,
        "A feature's proposal card could not be loaded; the proposal was not rendered",
        { kind: contribution.kind, reason: String(reason) }
      )
      console.error(error.toLogLine())
      return { default: () => null }
    }
  })
  byKind.set(contribution.kind, card)
  return card
}

/**
 * The card for a proposal an installed feature owns, and the payload to give
 * it, or null if this build cannot draw it.
 *
 * Null covers both refusals, and both are logged under the same id because they
 * are one event to whoever reads the log: this build received a proposal it
 * will not show the user. The context says which.
 */
export function resolveContributedProposal(
  proposal: AnyProposal,
  registry: Record<string, FeatureDescriptor> = FEATURES
): { proposal: FeatureProposal; Card: Card } | null {
  const contribution = proposalContributionFor(proposal.kind, registry)
  if (!contribution) {
    return ignore(
      'A proposal arrived for a kind no installed feature can render, and was ignored',
      { kind: proposal.kind, known: contributedProposalKinds(registry) }
    )
  }

  const parsed = contribution.parse(proposal)
  if (!parsed) {
    return ignore(
      "A proposal was rejected by the feature that owns its kind, and was ignored",
      { kind: proposal.kind }
    )
  }

  return { proposal: parsed, Card: cardFor(contribution, registry) }
}
