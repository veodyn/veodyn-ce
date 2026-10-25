import type { ComponentType } from 'react'
import type { SidecarTransport } from '@/lib/chat/sidecar-transport'
import type { CallView } from '@/lib/chat/thread-calls'
import type { ChatToolResult, ContributedToolResult } from '@/lib/chat/tool-results'
import type { RedashTransport } from '@/lib/chat/transport'

export type ContributedChatTool = string

export interface ChatToolContext {
  sidecar: SidecarTransport
}

export type ChatToolRunner = (
  args: Record<string, unknown>,
  signal: AbortSignal,
  transport: RedashTransport,
  context: ChatToolContext
) => Promise<ChatToolResult | ContributedToolResult>

export interface ChatToolCardProps {
  call: CallView
}

export interface ChatToolContribution {
  tool: ContributedChatTool
  resultKind?: string
  execute: () => Promise<{ default: ChatToolRunner }>
  card?: () => Promise<{ default: ComponentType<ChatToolCardProps> }>
  phaseLabel?: string
}
