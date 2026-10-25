import { isContributedTool } from '@/features/chat-tools'
import { draftKind, type DraftSlot } from './draft-kinds'
import { isApplied } from './promotions'
import type { SavedRunSpec } from './run-spec'
import { ERROR_CHARS } from './tool-results'
import { storedHelpLink, type HelpLinkView } from './thread-help'
import { isCardTool, positiveId, savedRunView, storedCall, type CallView, type CardToolName } from './thread-calls'
import type {
  ActiveDashboard,
  ContributedDraftView,
  DashboardDraftView,
  DashboardEditDraftView,
  Draft,
  DraftView,
  EditDraftView,
  OperationDraftView,
  RunView,
  TurnItem,
  TurnView,
  ThreadState,
  VizDraftView,
} from './thread-model'
import type { ChatPromotion, ChatThreadDetail } from './wire'

export const FAILED_TURN_MESSAGE = 'This turn did not finish.'

function isContributedName(name: unknown): name is string {
  return typeof name === 'string' && isContributedTool(name)
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    return record(JSON.parse(value))
  } catch {
    return { error: value.slice(0, ERROR_CHARS) }
  }
}

function queryBodyFrom(input: Record<string, unknown>): string {
  if (typeof input.sql === 'string') return input.sql
  if (input.resourceCall && typeof input.resourceCall === 'object') return JSON.stringify(input.resourceCall)
  return ''
}

function storedSavedRun(input: Record<string, unknown>): SavedRunSpec | null {
  const queryId = positiveId(input.queryId)
  if (queryId === null) return null
  return { queryId, parameters: record(input.params), visualizationId: positiveId(input.visualizationId) }
}

export function appendText(items: TurnItem[], text: string): TurnItem[] {
  const last = items[items.length - 1]
  if (last?.kind === 'text') return [...items.slice(0, -1), { kind: 'text', text: last.text + text }]
  return [...items, { kind: 'text', text }]
}

export function withVersion<Payload>(
  draft: Draft<Payload> | undefined,
  id: string,
  version: number,
  payload: Payload
): Draft<Payload> {
  const base = draft ?? { id, versions: [], promotions: [] }
  if (base.versions.some((one) => one.version === version)) return base
  return { ...base, versions: [...base.versions, { version, payload }].sort((a, b) => a.version - b.version) }
}

interface DashboardEvent {
  at: string
  dashboard: ActiveDashboard
}

interface Parts {
  runs: Record<string, RunView>
  calls: Record<string, CallView>
  helpLinks: Record<string, HelpLinkView>
  dashboardEvents: DashboardEvent[]
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
          dataSourceId: typeof content.dataSourceId === 'number' ? content.dataSourceId : 0,
          purpose: String(input.purpose ?? ''),
          sql: queryBodyFrom(input),
          vizChoiceId: String(input.vizChoiceId ?? 'table'),
          status: content.ok === true ? 'done' : 'failed',
          rowCount: typeof content.rowCount === 'number' ? content.rowCount : null,
          durationMs: null,
          error: typeof content.error === 'string' ? content.error : null,
        }
        items = [...items, { kind: 'run', callId }]
      }
      const browserRan = outcome !== undefined && (!outcome.is_error || content.kind === 'query_result')
      const saved = item.name === 'run_saved_query' && browserRan ? storedSavedRun(input) : null
      if (saved) {
        parts.runs[callId] = savedRunView(callId, String(input.purpose ?? ''), saved, {
          dataSourceId: typeof content.dataSourceId === 'number' ? content.dataSourceId : 0,
          status: content.ok === true ? 'done' : 'failed',
          rowCount: typeof content.rowCount === 'number' ? content.rowCount : null,
          error: typeof content.error === 'string' ? content.error : null,
        })
        items = [...items, { kind: 'run', callId }]
      }
      if ((isCardTool(item.name) || isContributedName(item.name)) && outcome) {
        parts.calls[callId] = storedCall(callId, item.name as CardToolName, input, content)
        items = [...items, { kind: 'call', callId }]
      }
      if (item.name === 'open_dashboard' && outcome && !outcome.is_error && content.ok === true) {
        const dashboard = record(content.dashboard)
        if (typeof dashboard.id === 'number') {
          parts.dashboardEvents.push({
            at: turn.finishedAt ?? turn.createdAt,
            dashboard: {
              id: dashboard.id,
              name: String(dashboard.name ?? ''),
              widgetCount:
                typeof content.widgetCount === 'number'
                  ? content.widgetCount
                  : Array.isArray(content.widgets)
                    ? content.widgets.length
                    : 0,
            },
          })
        }
      }
      if (item.name === 'link_help') {
        const link = storedHelpLink(callId, input, content)
        if (link) {
          parts.helpLinks[callId] = link
          items = [...items, { kind: 'help', callId }]
        }
      }
      if (typeof content.draftId === 'string' && typeof content.version === 'number') {
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
    lastEventId: turn.lastEventId ?? null,
  }
}

function latestDashboard(events: DashboardEvent[]): ActiveDashboard | null {
  if (events.length === 0) return null
  return events.reduce((latest, event) => (event.at > latest.at ? event : latest)).dashboard
}

export function fromDetail(detail: ChatThreadDetail): ThreadState {
  const parts: Parts = { runs: {}, calls: {}, helpLinks: {}, dashboardEvents: [] }
  const slots: Record<DraftSlot, Record<string, Draft<unknown>>> = {
    drafts: {},
    dashboardDrafts: {},
    editDrafts: {},
    vizDrafts: {},
    dashboardEditDrafts: {},
    operationDrafts: {},
    contributedDrafts: {},
  }
  for (const draft of detail.drafts) {
    const kind = draftKind(draft.kind)
    let view: Draft<unknown> = { id: draft.id, versions: [], promotions: draft.promotions }
    for (const version of draft.versions) {
      const payload = kind.parse(version.payload)
      if (payload !== null) view = withVersion(view, draft.id, version.version, payload)
    }
    slots[kind.slot][draft.id] = (kind.slot === 'contributedDrafts' ? { ...view, kind: draft.kind } : view) as Draft<unknown>
    if (draft.kind === 'dashboard') dashboardEventsOf(view as DashboardDraftView, parts.dashboardEvents)
    if (draft.kind === 'dashboard_edit') editEventsOf(view as DashboardEditDraftView, parts.dashboardEvents)
  }
  const turns = detail.turns.map((turn) => storedTurn(turn, parts))
  const { dashboardEvents, ...rest } = parts
  return {
    turns,
    drafts: slots.drafts as Record<string, DraftView>,
    dashboardDrafts: slots.dashboardDrafts as Record<string, DashboardDraftView>,
    editDrafts: slots.editDrafts as Record<string, EditDraftView>,
    vizDrafts: slots.vizDrafts as Record<string, VizDraftView>,
    dashboardEditDrafts: slots.dashboardEditDrafts as Record<string, DashboardEditDraftView>,
    operationDrafts: slots.operationDrafts as Record<string, OperationDraftView>,
    contributedDrafts: slots.contributedDrafts as Record<string, ContributedDraftView>,
    activeDashboard: latestDashboard(dashboardEvents),
    queryDraftSync: {},
    ...rest,
  }
}

function widgetsRecorded(promotion: ChatPromotion): number {
  return promotion.receipts.filter((receipt) => receipt.step > 0 && receipt.outcome === 'done').length
}

function dashboardEventsOf(view: DashboardDraftView, events: DashboardEvent[]): void {
  for (const promotion of view.promotions) {
    if (promotion.targetType !== 'dashboard' || !isApplied(promotion)) continue
    const version = view.versions.find((one) => one.version === promotion.promotedVersion)
    if (!version) continue
    events.push({
      at: promotion.createdAt,
      dashboard: {
        id: Number(promotion.targetId),
        name: version.payload.name,
        widgetCount: promotion.targetVersionAtPromote ?? widgetsRecorded(promotion),
      },
    })
  }
}

function editEventsOf(view: DashboardEditDraftView, events: DashboardEvent[]): void {
  for (const promotion of view.promotions) {
    if (promotion.targetType !== 'dashboard' || promotion.status !== 'done' || promotion.targetId === null) continue
    if (promotion.targetVersionAtPromote === null) continue
    const version = view.versions.find((one) => one.version === promotion.promotedVersion)
    if (!version) continue
    events.push({
      at: promotion.createdAt,
      dashboard: {
        id: Number(promotion.targetId),
        name: version.payload.name ?? version.payload.snapshot.name,
        widgetCount: promotion.targetVersionAtPromote,
      },
    })
  }
}
