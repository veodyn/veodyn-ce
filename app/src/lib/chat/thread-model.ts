import { chatProposalSchema, type ChatFrame, type ChatProposal } from './frames'
import type { ChatPromotion, ChatThreadDetail } from './wire'

export type TurnStatus = 'running' | 'done' | 'failed'
export type RunStatus = 'running' | 'done' | 'failed'

export interface RunView {
  callId: string
  purpose: string
  sql: string
  vizChoiceId: string
  status: RunStatus
  rowCount: number | null
  durationMs: number | null
  error: string | null
}

export type TurnItem =
  | { kind: 'text'; text: string }
  | { kind: 'run'; callId: string }
  | { kind: 'draft'; draftId: string; version: number }

export interface TurnView {
  id: string
  seq: number
  userText: string
  status: TurnStatus
  items: TurnItem[]
  phase: string | null
  stopReason: string | null
  errorMessage: string | null
  lastEventId: string | null
}

export interface DraftView {
  id: string
  versions: { version: number; payload: ChatProposal }[]
  promotions: ChatPromotion[]
}

export interface ThreadState {
  turns: TurnView[]
  runs: Record<string, RunView>
  drafts: Record<string, DraftView>
}

export const FAILED_TURN_MESSAGE = 'This turn did not finish.'

export function emptyThread(): ThreadState {
  return { turns: [], runs: {}, drafts: {} }
}

function streamOrder(id: string): [number, number] {
  const [time, seq] = id.split('-').map(Number)
  return [time || 0, seq || 0]
}

export function isAfter(id: string, previous: string | null): boolean {
  if (previous === null) return true
  const [a, b] = streamOrder(id)
  const [c, d] = streamOrder(previous)
  return a > c || (a === c && b > d)
}

function appendText(items: TurnItem[], text: string): TurnItem[] {
  const last = items[items.length - 1]
  if (last?.kind === 'text') return [...items.slice(0, -1), { kind: 'text', text: last.text + text }]
  return [...items, { kind: 'text', text }]
}

function record(value: unknown): Record<string, unknown> {
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

function withVersion(draft: DraftView | undefined, id: string, version: number, payload: ChatProposal): DraftView {
  const base = draft ?? { id, versions: [], promotions: [] }
  if (base.versions.some((one) => one.version === version)) return base
  return { ...base, versions: [...base.versions, { version, payload }].sort((a, b) => a.version - b.version) }
}

function storedTurn(turn: ChatThreadDetail['turns'][number], runs: Record<string, RunView>): TurnView {
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
        runs[callId] = {
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
  const runs: Record<string, RunView> = {}
  const drafts: Record<string, DraftView> = {}
  for (const draft of detail.drafts) {
    let view: DraftView = { id: draft.id, versions: [], promotions: draft.promotions }
    for (const version of draft.versions) {
      const payload = chatProposalSchema.safeParse(version.payload)
      if (payload.success) view = withVersion(view, draft.id, version.version, payload.data)
    }
    drafts[draft.id] = view
  }
  const turns = detail.turns.map((turn) => storedTurn(turn, runs))
  return { turns, runs, drafts }
}

export function startTurn(state: ThreadState, id: string, seq: number, userText: string): ThreadState {
  if (state.turns.some((turn) => turn.id === id)) return state
  const turn: TurnView = {
    id,
    seq,
    userText,
    status: 'running',
    items: [],
    phase: null,
    stopReason: null,
    errorMessage: null,
    lastEventId: null,
  }
  return { ...state, turns: [...state.turns, turn] }
}

function updateTurn(state: ThreadState, id: string, change: (turn: TurnView) => TurnView): ThreadState {
  return { ...state, turns: state.turns.map((turn) => (turn.id === id ? change(turn) : turn)) }
}

function updateRun(state: ThreadState, callId: string, change: Partial<RunView>): ThreadState {
  const run = state.runs[callId]
  return run ? { ...state, runs: { ...state.runs, [callId]: { ...run, ...change } } } : state
}

export function applyFrame(state: ThreadState, turnId: string, frame: ChatFrame): ThreadState {
  const turn = state.turns.find((one) => one.id === turnId)
  if (!turn || (frame.id !== null && !isAfter(frame.id, turn.lastEventId))) return state
  const seen = (next: ThreadState) =>
    frame.id === null ? next : updateTurn(next, turnId, (one) => ({ ...one, lastEventId: frame.id }))
  switch (frame.event) {
    case 'turn_started':
      return seen(state)
    case 'text_delta':
      return seen(updateTurn(state, turnId, (one) => ({ ...one, items: appendText(one.items, frame.data.text) })))
    case 'status':
      return seen(updateTurn(state, turnId, (one) => ({ ...one, phase: frame.data.phase })))
    case 'tool_request': {
      const { callId, args } = frame.data
      const run: RunView = {
        callId,
        purpose: args.purpose,
        sql: args.sql,
        vizChoiceId: args.vizChoiceId,
        status: 'running',
        rowCount: null,
        durationMs: null,
        error: null,
      }
      const next = { ...state, runs: { ...state.runs, [callId]: state.runs[callId] ?? run } }
      return seen(updateTurn(next, turnId, (one) => ({ ...one, items: [...one.items, { kind: 'run', callId }] })))
    }
    case 'tool_settled': {
      const { callId, ok, rowCount, durationMs } = frame.data
      const current = state.runs[callId]
      return seen(
        updateRun(state, callId, {
          status: ok ? 'done' : 'failed',
          rowCount: rowCount ?? current?.rowCount ?? null,
          durationMs,
        })
      )
    }
    case 'draft': {
      const { draftId, version, payload } = frame.data
      const next = { ...state, drafts: { ...state.drafts, [draftId]: withVersion(state.drafts[draftId], draftId, version, payload) } }
      return seen(
        updateTurn(next, turnId, (one) => ({ ...one, items: [...one.items, { kind: 'draft', draftId, version }] }))
      )
    }
    case 'turn_done':
      return seen(
        updateTurn(state, turnId, (one) => ({ ...one, status: 'done', phase: null, stopReason: frame.data.stopReason }))
      )
    case 'error':
      return seen(
        updateTurn(state, turnId, (one) => ({ ...one, status: 'failed', phase: null, errorMessage: frame.data.message }))
      )
  }
}

export function failTurn(state: ThreadState, turnId: string, message: string): ThreadState {
  return updateTurn(state, turnId, (turn) =>
    turn.status === 'running' ? { ...turn, status: 'failed', phase: null, errorMessage: message } : turn
  )
}

export function setRunError(state: ThreadState, callId: string, error: string): ThreadState {
  return updateRun(state, callId, { error })
}

export function addPromotion(state: ThreadState, draftId: string, promotion: ChatPromotion): ThreadState {
  const draft = state.drafts[draftId]
  if (!draft) return state
  return { ...state, drafts: { ...state.drafts, [draftId]: { ...draft, promotions: [...draft.promotions, promotion] } } }
}

export function runningTurn(state: ThreadState): TurnView | null {
  return state.turns.find((turn) => turn.status === 'running') ?? null
}
