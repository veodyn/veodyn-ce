// The registry seam for data chat tools a feature runs and draws. The wire
// shape of each tool is community (see chat-tool-types.ts); this finds the
// feature behind one, runs it, and hands back its card.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { ChatToolRequestOf } from '@/lib/chat/frames'
import { failedResult, toolResultSchema, type ChatResultKind, type ChatToolResult } from '@/lib/chat/tool-results'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { ChatToolCardProps, ChatToolContribution, ContributedChatTool } from './chat-tool-types'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { FeatureDescriptor } from './types'

type Registry = Record<string, FeatureDescriptor>
type Card = LazyExoticComponent<ComponentType<ChatToolCardProps>>

export type ContributedToolRequest = ChatToolRequestOf<ContributedChatTool>

export const CONTRIBUTED_RESULT_KIND = {
  show_kpi: 'kpi',
  list_kpis: 'kpi_list',
} as const satisfies Record<ContributedChatTool, ChatResultKind>

export const NO_CONTRIBUTOR_MESSAGE = 'This build cannot read KPIs.'
export const UNREADABLE_RESULT_MESSAGE = 'The result could not be read.'

export function isContributedTool(tool: string): tool is ContributedChatTool {
  return Object.hasOwn(CONTRIBUTED_RESULT_KIND, tool)
}

export function chatToolContributionFor(tool: string, registry: Registry = FEATURES): ChatToolContribution | undefined {
  for (const feature of featureList(registry)) {
    const contribution = feature.chatTools?.find((entry) => entry.tool === tool)
    if (contribution) return contribution
  }
  return undefined
}

/**
 * Always resolves to a result of the kind the sidecar is waiting for, except on
 * an abort, which is rethrown. A sidecar that offers a tool this build has no
 * feature for would otherwise leave the turn waiting out its whole tool
 * timeout, and so would a feature that returned the wrong kind: the relay
 * refuses it and nothing else ever answers the call.
 */
export async function runContributedTool(
  request: ContributedToolRequest,
  signal: AbortSignal,
  registry: Registry = FEATURES
): Promise<ChatToolResult> {
  const kind = CONTRIBUTED_RESULT_KIND[request.tool]
  const contribution = chatToolContributionFor(request.tool, registry)
  if (!contribution) return failedResult(kind, new Error(NO_CONTRIBUTOR_MESSAGE))
  try {
    const { default: run } = await contribution.execute()
    const parsed = toolResultSchema.safeParse(await run(request.args, signal))
    if (parsed.success && parsed.data.kind === kind) return parsed.data
    return failedResult(kind, new Error(UNREADABLE_RESULT_MESSAGE))
  } catch (error) {
    if (signal.aborted) throw error
    return failedResult(kind, error)
  }
}

const cards = new WeakMap<Registry, Map<string, Card>>()

/** The contributed card for a tool, cached per registry so a render never remounts it. */
export function chatToolCardFor(tool: string, registry: Registry = FEATURES): Card | undefined {
  const contribution = chatToolContributionFor(tool, registry)
  if (!contribution) return undefined
  let byTool = cards.get(registry)
  if (!byTool) {
    byTool = new Map()
    cards.set(registry, byTool)
  }
  const cached = byTool.get(tool)
  if (cached) return cached

  const card = lazy(async () => {
    try {
      return await contribution.card()
    } catch (reason) {
      const error = new AppError(
        ErrorIds.CHAT_TOOL_CARD_UNAVAILABLE,
        "A feature's chat tool card could not be loaded; the call was not drawn",
        { tool, reason: String(reason) }
      )
      console.error(error.toLogLine())
      return { default: () => null }
    }
  })
  byTool.set(tool, card)
  return card
}
