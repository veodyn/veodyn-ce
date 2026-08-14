// Create-with-AI proposal card types, split out of features/types.ts when
// adding the two published-feed slot ids pushed that file over the size
// hook. Proposals are already their own concern with their own registry file
// (features/proposals.ts), which is the seam this follows: the card contract
// moves here, and FeatureDescriptor in types.ts imports ProposalContribution
// back in rather than declaring it inline.
import type { ComponentType } from 'react'
import type { FeatureProposal } from '@/types/ai-create'

/**
 * What a contributed proposal card is rendered with.
 *
 * `proposal` is the opaque wire payload, not the feature's own type: this
 * module is community, so it cannot name `KpiProposal`. The card narrows it on
 * the other side of the loader, where that type is in scope.
 */
export interface ProposalCardProps {
  proposal: FeatureProposal
  /** Called once the object exists, with where to send the user (null = stay). */
  onCreated: (href: string | null) => void
  /** True while a create is in flight, so the chat shell can lock its composer. */
  onBusyChange: (busy: boolean) => void
}

/**
 * A loader for the module whose default export is the card, never the card
 * itself. Same rule as `searchSource` and `SlotLoader` in features/types.ts,
 * and for the same reason: a descriptor holding a component value would put
 * that component, and everything it imports, on every route's pre-paint path.
 */
export type ProposalRenderLoader = () => Promise<{ default: ComponentType<ProposalCardProps> }>

/**
 * How a feature claims one `kind` of Create-with-AI proposal.
 *
 * The conversation contract is community: `schemas/ai_create.py` can converge
 * on a proposed KPI on a build that has no endpoint to create one, so a
 * community browser really does receive these. What it does not have is a card,
 * and that is what this contributes.
 *
 * `parse` and the card's own narrowing are two stages, not one check written
 * twice. `parse` runs BEFORE the loader is entered, with only the community
 * types in scope, and answers "is this payload mine, and is it whole enough to
 * be worth fetching a chunk for". The card, on the other side of the loader,
 * narrows the same payload to the feature's own type, which is the only place
 * that type exists. A payload `parse` rejects costs no chunk and renders
 * nothing.
 */
export interface ProposalContribution {
  /** The `kind` discriminator this feature answers for, e.g. `'kpi'`. */
  kind: string
  parse: (raw: unknown) => FeatureProposal | null
  render: ProposalRenderLoader
  /**
   * Where the chat sends someone when the AI cannot finish this kind.
   *
   * On the contribution rather than in the chat's own copy table because it is
   * a ROUTE, and a route belongs to whoever ships it. The table
   * (`MANUAL_PATHS` in components/ai/create-chat/create-chat-model.ts) is keyed
   * by `CreateKind`, which names all five kinds because the SERVICE contract
   * does, so a community build held an escape hatch pointing at `/kpis/new`:
   * a link with nothing behind it. The community kinds keep their entries
   * there; the feature kinds bring their own or offer none.
   *
   * Optional, because a feature can claim a kind without having a manual path
   * to offer, exactly as `dashboard` has no `/dashboards/new` to point at.
   */
  manual?: ProposalManualPath
}

/** A link out of the chat to the by-hand route, with the words on it. */
export interface ProposalManualPath {
  href: string
  label: string
}
