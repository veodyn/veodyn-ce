// Data chat tool contribution types, split out of features/types.ts for file
// size. features/chat-tools.ts is the registry seam that reads them.
import type { ComponentType } from 'react'
import type { ChatToolName } from '@/lib/chat/frames'
import type { CallView } from '@/lib/chat/thread-calls'
import type { ChatToolResult } from '@/lib/chat/tool-results'

/**
 * The chat tools a feature answers for, which is a subset of the tools the wire
 * names. The WIRE is community: lib/chat/frames.ts and lib/chat/tool-results.ts
 * spell out `show_kpi` and its result field by field, because the relay
 * revalidates every frame and every result against a closed set and a tool the
 * relay has never heard of is cut off in both directions. What a community
 * build lacks is the code that reads a KPI and the card that draws one, which
 * is what this contributes. Same split as a Create-with-AI proposal kind.
 */
export type ContributedChatTool = Extract<ChatToolName, 'show_kpi' | 'list_kpis'>

/**
 * Runs the tool in the browser, under the analyst's own session, and returns
 * the result exactly as it goes back to the model. `args` has already been
 * checked against the tool's frame schema. Throwing is allowed and is posted
 * as a failed result; an abort is rethrown and posts nothing.
 */
export type ChatToolRunner = (args: Record<string, unknown>, signal: AbortSignal) => Promise<ChatToolResult>

/**
 * What a contributed card is rendered with. The card draws from `call.output`
 * and from nothing it fetches for itself, so a reloaded conversation redraws it
 * from the stored result.
 */
export interface ChatToolCardProps {
  call: CallView
}

/** Loaders, never the modules themselves: the pre-paint rule in features/types.ts. */
export interface ChatToolContribution {
  tool: ContributedChatTool
  execute: () => Promise<{ default: ChatToolRunner }>
  card: () => Promise<{ default: ComponentType<ChatToolCardProps> }>
  /** What the transcript says while the browser runs this tool. */
  phaseLabel?: string
}
