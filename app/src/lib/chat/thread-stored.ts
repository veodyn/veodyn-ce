import { chatProposalSchema, type ChatProposal } from './frames'
import { storedHelpLink, type HelpLinkView } from './thread-help'
import { isLibraryTool, storedCall, type CallView } from './thread-calls'
import type { DraftView, RunView, ThreadState, TurnItem, TurnView } from './thread-model'
import type { ChatThreadDetail } from './wire'

export const FAILED_TURN_MESSAGE = 'This turn did not finish.'

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    return record(JSON.parse(value))
  } catch {
    return {}
  }
}

export function appendText(items: TurnItem[], text: string): TurnItem[] {
  const last = items[items.length - 1]
  if (last?.kind === 'text') return [...items.slice(0, -1), { kind: 'text', text: last.text + text }]
  return [...items, { kind: 'text', text }]
}

export function withVersion(
  draft: DraftView | undefined,
  id: string,
  version: number,
  payload: ChatProposal
): DraftView {
  const base = draft ?? { id, versions: [], promotions: [] }
  if (base.versions.some((one) => one.version === version)) return base
  return { ...base, versions: [...base.versions, { version, payload }].sort((a, b) => a.version - b.version) }
}

interface Parts {
  runs: Record<string, RunView>
  calls: Record<string, CallView>
  helpLinks: Record<string, HelpLinkView>
}

function storedTurn(turn: ChatThreadDetail['turns'][number], parts: Parts): TurnView {
  const results = new Map<string, Record<string, unknown>>()
  for (const message of turn.blocks) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const item = record(block)
      if (item.type === 'tool_result') results.set(String(item.tool_use_id), item)
    }
  }
  let items: TurnItem[] = []
  for (const message of turn.blocks) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      const item = record(block)
      if (item.type === 'text' && typeof item.text === 'string') items = appendText(items, item.text)
      if (item.type !== 'tool_use') continue
      const callId = String(item.id)
      const input = record(item.input)
      const outcome = results.get(callId)
      const content = parseJson(outcome?.content)
      if (item.name === 'run_query' && outcome && !outcome.is_error) {
        parts.runs[callId] = {
          callId,
          purpose: String(input.purpose ?? ''),
          sql: String(input.sql ?? ''),
          vizChoiceId: String(input.vizChoiceId ?? 'table'),
          status: content.ok === true ? 'done' : 'failed',
          rowCount: typeof content.rowCount === 'number' ? content.rowCount : null,
          durationMs: null,
          error: typeof content.error === 'string' ? content.error : null,
        }
        items = [...items, { kind: 'run', callId }]
      }
      if (isLibraryTool(item.name) && outcome) {
        parts.calls[callId] = storedCall(callId, item.name, input, content)
        items = [...items, { kind: 'call', callId }]
      }
      if (item.name === 'link_help') {
        const link = storedHelpLink(callId, input, content)
        if (link) {
          parts.helpLinks[callId] = link
          items = [...items, { kind: 'help', callId }]
        }
      }
      if (item.name === 'propose_query' && typeof content.draftId === 'string' && typeof content.version === 'number') {
        items = [...items, { kind: 'draft', draftId: content.draftId, version: content.version }]
      }
    }
  }
  return {
    id: turn.id,
    seq: turn.seq,
    userText: turn.userText,
    status: turn.status,
    items,
    phase: null,
    stopReason: turn.stopReason,
    errorMessage: turn.status === 'failed' ? FAILED_TURN_MESSAGE : null,
    lastEventId: null,
  }
}

export function fromDetail(detail: ChatThreadDetail): ThreadState {
  const parts: Parts = { runs: {}, calls: {}, helpLinks: {} }
  const drafts: Record<string, DraftView> = {}
  for (const draft of detail.drafts) {
    let view: DraftView = { id: draft.id, versions: [], promotions: draft.promotions }
    for (const version of draft.versions) {
      const payload = chatProposalSchema.safeParse(version.payload)
      if (payload.success) view = withVersion(view, draft.id, version.version, payload.data)
    }
    drafts[draft.id] = view
  }
  const turns = detail.turns.map((turn) => storedTurn(turn, parts))
  return { turns, drafts, ...parts }
}
