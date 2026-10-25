import type { DashboardEditPayload } from './dashboard-changes'
import type { OperationPayload } from './operation-changes'
import { isOpenToolRequest, type ChatFrame, type ChatProposal, type DashboardProposal, type QueryEditPayload } from './frames'
import { savedRunView, settledView, type CallView, type RunStatus } from './thread-calls'
import type { SavedRunSpec } from './run-spec'
import { isAfter } from './stream-order'
import type { HelpLinkView } from './thread-help'
import { putDraft } from './thread-drafts'
import { appendText } from './thread-stored'
import type { QueryDraftSyncs } from './thread-sync'
import { isOpenResult, type ChatToolResult, type OpenToolResult } from './tool-results'
import type { VizPayload } from './viz-changes'
import type { ChatPromotion } from './wire'

export type { CallView, CardToolName, RunStatus } from './thread-calls'
export {
  addContributedPromotion,
  addDashboardPromotion,
  addEditPromotion,
  addOperationPromotion,
  addPromotion,
  addVizPromotion,
} from './thread-drafts'
export type { HelpLinkView } from './thread-help'
export { isAfter } from './stream-order'
export { FAILED_TURN_MESSAGE, fromDetail } from './thread-stored'

export type TurnStatus = 'running' | 'done' | 'failed'

export interface RunView {
  callId: string
  dataSourceId: number
  purpose: string
  sql: string
  vizChoiceId: string
  status: RunStatus
  rowCount: number | null
  durationMs: number | null
  error: string | null
  saved?: SavedRunSpec
}

export type TurnItem =
  | { kind: 'text'; text: string }
  | { kind: 'run'; callId: string }
  | { kind: 'call'; callId: string }
  | { kind: 'help'; callId: string }
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

export interface Draft<Payload> {
  id: string
  versions: { version: number; payload: Payload }[]
  promotions: ChatPromotion[]
}

export type DraftView = Draft<ChatProposal>
export type DashboardDraftView = Draft<DashboardProposal>
export type EditDraftView = Draft<QueryEditPayload>
export type VizDraftView = Draft<VizPayload>
export type DashboardEditDraftView = Draft<DashboardEditPayload>
export type OperationDraftView = Draft<OperationPayload>
export interface ContributedDraftView extends Draft<unknown> {
  kind: string
}

export interface ActiveDashboard {
  id: number
  name: string
  widgetCount: number
}

export interface ThreadState {
  turns: TurnView[]
  runs: Record<string, RunView>
  calls: Record<string, CallView>
  helpLinks: Record<string, HelpLinkView>
  drafts: Record<string, DraftView>
  dashboardDrafts: Record<string, DashboardDraftView>
  editDrafts: Record<string, EditDraftView>
  vizDrafts: Record<string, VizDraftView>
  dashboardEditDrafts: Record<string, DashboardEditDraftView>
  operationDrafts: Record<string, OperationDraftView>
  contributedDrafts: Record<string, ContributedDraftView>
  activeDashboard: ActiveDashboard | null
  queryDraftSync: QueryDraftSyncs
}

export function emptyThread(): ThreadState {
  return {
    turns: [],
    runs: {},
    calls: {},
    helpLinks: {},
    drafts: {},
    dashboardDrafts: {},
    editDrafts: {},
    vizDrafts: {},
    dashboardEditDrafts: {},
    operationDrafts: {},
    contributedDrafts: {},
    activeDashboard: null,
    queryDraftSync: {},
  }
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

function withItem(state: ThreadState, turnId: string, item: TurnItem): ThreadState {
  return updateTurn(state, turnId, (one) => ({ ...one, items: [...one.items, item] }))
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
      const request = frame.data
      const { callId } = request
      if (isOpenToolRequest(request)) {
        const call: CallView = { callId, tool: request.tool, status: 'running', target: null, output: null, error: null }
        const next = { ...state, calls: { ...state.calls, [callId]: state.calls[callId] ?? call } }
        return seen(withItem(next, turnId, { kind: 'call', callId }))
      }
      if (request.tool === 'run_saved_query') {
        const { args } = request
        const run = savedRunView(callId, args.purpose, {
          queryId: args.queryId,
          parameters: args.parameters,
          visualizationId: args.visualizationId,
        })
        const next = { ...state, runs: { ...state.runs, [callId]: state.runs[callId] ?? run } }
        return seen(withItem(next, turnId, { kind: 'run', callId }))
      }
      if (request.tool !== 'run_query') {
        const call: CallView = {
          callId,
          tool: request.tool,
          status: 'running',
          target: request.tool === 'show_visualization' ? { ...request.args } : null,
          output: null,
          error: null,
        }
        const next = { ...state, calls: { ...state.calls, [callId]: state.calls[callId] ?? call } }
        return seen(withItem(next, turnId, { kind: 'call', callId }))
      }
      const { args } = request
      const run: RunView = {
        callId,
        dataSourceId: args.dataSourceId,
        purpose: args.purpose,
        sql: args.sql,
        vizChoiceId: args.vizChoiceId,
        status: 'running',
        rowCount: null,
        durationMs: null,
        error: null,
      }
      const next = { ...state, runs: { ...state.runs, [callId]: state.runs[callId] ?? run } }
      return seen(withItem(next, turnId, { kind: 'run', callId }))
    }
    case 'tool_settled': {
      const { callId, ok, rowCount, durationMs } = frame.data
      const call = state.calls[callId]
      if (call) {
        const keepsOwnStatus = call.output && !(isOpenResult(call.output) && !ok)
        const status = keepsOwnStatus ? call.status : ok ? 'done' : 'failed'
        return seen({ ...state, calls: { ...state.calls, [callId]: { ...call, status } } })
      }
      const current = state.runs[callId]
      return seen(
        updateRun(state, callId, {
          status: ok ? 'done' : 'failed',
          rowCount: rowCount ?? current?.rowCount ?? null,
          durationMs,
        })
      )
    }
    case 'help_link': {
      const link = frame.data
      const next = { ...state, helpLinks: { ...state.helpLinks, [link.callId]: link } }
      return seen(withItem(next, turnId, { kind: 'help', callId: link.callId }))
    }
    case 'draft': {
      const { draftId, version } = frame.data
      return seen(withItem(putDraft(state, frame.data), turnId, { kind: 'draft', draftId, version }))
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

export function settleCall(state: ThreadState, callId: string, result: ChatToolResult | OpenToolResult): ThreadState {
  const call = state.calls[callId]
  if (!call) return state
  const next = { ...state, calls: { ...state.calls, [callId]: settledView(call, result) } }
  if (!isOpenResult(result) && call.tool === 'open_dashboard' && result.kind === 'dashboard' && result.ok && result.dashboard) {
    return setActiveDashboard(next, {
      id: result.dashboard.id,
      name: result.dashboard.name,
      widgetCount: result.widgetCount ?? result.widgets?.length ?? 0,
    })
  }
  return next
}

export function setRunError(state: ThreadState, callId: string, error: string): ThreadState {
  return updateRun(state, callId, { error })
}

export function setActiveDashboard(state: ThreadState, dashboard: ActiveDashboard): ThreadState {
  return { ...state, activeDashboard: dashboard }
}

export function runningTurn(state: ThreadState): TurnView | null {
  return state.turns.find((turn) => turn.status === 'running') ?? null
}
