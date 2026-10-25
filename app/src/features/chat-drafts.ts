import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { parseSnippetDraft, parseSnippetEditDraft } from '@/lib/chat/snippet-drafts'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { ChatDraftCardProps, ChatDraftContribution } from './chat-draft-types'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { FeatureDescriptor } from './types'

type Registry = Record<string, FeatureDescriptor>
type Card = LazyExoticComponent<ComponentType<ChatDraftCardProps>>

const COMMUNITY_DRAFTS: ChatDraftContribution[] = [
  {
    kind: 'snippet',
    parse: parseSnippetDraft,
    card: () => import('@/components/chat/snippet-draft-card'),
  },
  {
    kind: 'snippet_edit',
    parse: parseSnippetEditDraft,
    card: () => import('@/components/chat/snippet-edit-card'),
  },
]

export function chatDraftContributionFor(kind: string, registry: Registry = FEATURES): ChatDraftContribution | undefined {
  const own = COMMUNITY_DRAFTS.find((entry) => entry.kind === kind)
  if (own) return own
  for (const feature of featureList(registry)) {
    const contribution = feature.chatDrafts?.find((entry) => entry.kind === kind)
    if (contribution) return contribution
  }
  return undefined
}

const cards = new WeakMap<Registry, Map<string, Card>>()

export function chatDraftCardFor(kind: string, registry: Registry = FEATURES): Card | undefined {
  const contribution = chatDraftContributionFor(kind, registry)
  if (!contribution) return undefined
  let byKind = cards.get(registry)
  if (!byKind) {
    byKind = new Map()
    cards.set(registry, byKind)
  }
  const cached = byKind.get(kind)
  if (cached) return cached

  const card = lazy(async () => {
    try {
      return await contribution.card()
    } catch (reason) {
      const error = new AppError(
        ErrorIds.CHAT_TOOL_CARD_UNAVAILABLE,
        "A feature's chat draft card could not be loaded; the proposal was not drawn",
        { kind, reason: String(reason) }
      )
      console.error(error.toLogLine())
      return { default: () => null }
    }
  })
  byKind.set(kind, card)
  return card
}
