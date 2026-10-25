import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { isOpenToolRequest, type AnyToolRequest, type ChatToolRequestOf, type OpenToolRequest } from '@/lib/chat/frames'
import { toolResultSchema, type ChatToolResult, type OpenToolResult } from '@/lib/chat/tool-results'
import type { RedashTransport } from '@/lib/chat/transport'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { ChatToolCardProps, ChatToolContext, ChatToolContribution } from './chat-tool-types'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { FeatureDescriptor } from './types'

type Registry = Record<string, FeatureDescriptor>
type Card = LazyExoticComponent<ComponentType<ChatToolCardProps>>

export type KpiToolRequest = ChatToolRequestOf<'show_kpi' | 'list_kpis'>
export type ContributedToolRequest = OpenToolRequest | KpiToolRequest
export interface ContributedToolCall {
  callId: string
  tool: string
  args: Record<string, unknown>
  resultKind?: string
}

const KPI_RESULT_KIND: Record<string, string> = {
  show_kpi: 'kpi',
  list_kpis: 'kpi_list',
}

export function noContributorMessage(tool: string): string {
  return `This build cannot run ${tool}.`
}
export const UNREADABLE_RESULT_MESSAGE = 'The result could not be read.'
export const UNAVAILABLE_RESULT_KIND = 'unavailable'
const ERROR_CHARS = 500

function isKpiTool(tool: string): boolean {
  return Object.hasOwn(KPI_RESULT_KIND, tool)
}

export function chatToolContributionFor(tool: string, registry: Registry = FEATURES): ChatToolContribution | undefined {
  for (const feature of featureList(registry)) {
    const contribution = feature.chatTools?.find((entry) => entry.tool === tool)
    if (contribution) return contribution
  }
  return undefined
}

export function contributedResultKind(tool: string, registry: Registry = FEATURES): string | undefined {
  return chatToolContributionFor(tool, registry)?.resultKind ?? (isKpiTool(tool) ? KPI_RESULT_KIND[tool] : undefined)
}

export function isContributedTool(tool: string, registry: Registry = FEATURES): boolean {
  return isKpiTool(tool) || chatToolContributionFor(tool, registry) !== undefined
}

export function isContributedRequest(request: AnyToolRequest): request is ContributedToolRequest {
  return isOpenToolRequest(request) || isKpiTool(request.tool)
}

function failure(kind: string, error: unknown): ChatToolResult | OpenToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { kind, ok: false, error: (message || 'The request failed.').slice(0, ERROR_CHARS) } as OpenToolResult
}

export async function runContributedTool(
  request: ContributedToolCall,
  signal: AbortSignal,
  transport: RedashTransport,
  context: ChatToolContext,
  registry: Registry = FEATURES
): Promise<ChatToolResult | OpenToolResult> {
  const kind = contributedResultKind(request.tool, registry) ?? request.resultKind ?? UNAVAILABLE_RESULT_KIND
  const contribution = chatToolContributionFor(request.tool, registry)
  if (!contribution) return failure(kind, new Error(noContributorMessage(request.tool)))
  try {
    const { default: run } = await contribution.execute()
    const parsed = toolResultSchema.safeParse(await run(request.args, signal, transport, context))
    if (parsed.success && parsed.data.kind === kind) return parsed.data
    return failure(kind, new Error(UNREADABLE_RESULT_MESSAGE))
  } catch (error) {
    if (signal.aborted) throw error
    return failure(kind, error)
  }
}

const cards = new WeakMap<Registry, Map<string, Card>>()

export function chatToolCardFor(tool: string, registry: Registry = FEATURES): Card | undefined {
  const load = chatToolContributionFor(tool, registry)?.card
  if (!load) return undefined
  let byTool = cards.get(registry)
  if (!byTool) {
    byTool = new Map()
    cards.set(registry, byTool)
  }
  const cached = byTool.get(tool)
  if (cached) return cached

  const card = lazy(async () => {
    try {
      return await load()
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
