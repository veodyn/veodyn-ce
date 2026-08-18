// Create-with-AI proposal card types, split out of features/types.ts for file
// size. features/proposals.ts is the registry seam that reads them.
import type { ComponentType } from 'react'
import type { FeatureProposal } from '@/types/ai-create'

/**
 * What a contributed proposal card is rendered with. `proposal` is the opaque
 * wire payload, not the feature's own type: this module is community, so it
 * cannot name `KpiProposal`. The card narrows it on the other side of the
 * loader, where that type is in scope.
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
 * itself. Same pre-paint rule as `searchSource` and `SlotLoader` in
 * features/types.ts.
 */
export type ProposalRenderLoader = () => Promise<{ default: ComponentType<ProposalCardProps> }>

/**
 * How a feature claims one `kind` of Create-with-AI proposal.
 *
 * The conversation contract is community: `schemas/ai_create.py` can converge
 * on a proposed KPI on a build with no endpoint to create one, so a community
 * browser really does receive these. What it lacks is a card, which is what
 * this contributes.
 *
 * `parse` and the card's own narrowing are two stages, not one check written
 * twice. `parse` runs BEFORE the loader is entered, with only community types
 * in scope, and answers whether the payload is this feature's and whole enough
 * to be worth fetching a chunk for; the card narrows it to the feature's own
 * type on the other side. A payload `parse` rejects costs no chunk.
 */
export interface ProposalContribution {
  /** The `kind` discriminator this feature answers for, e.g. `'kpi'`. */
  kind: string
  parse: (raw: unknown) => FeatureProposal | null
  render: ProposalRenderLoader
  /**
   * Where the chat sends someone when the AI cannot finish this kind.
   *
   * On the contribution rather than in the chat's own copy table, because it is
   * a ROUTE and a route belongs to whoever ships it. That table (`MANUAL_PATHS`
   * in components/ai/create-chat/create-chat-model.ts) is keyed by `CreateKind`,
   * which names all five kinds because the SERVICE contract does, so a
   * community build there would offer `/kpis/new` with nothing behind it. The
   * community kinds keep their entries there; feature kinds bring their own.
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
