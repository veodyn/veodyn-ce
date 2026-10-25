import { readQueryError } from '@/lib/query-error'
import { recordPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import { ApiError } from '@/services/api-client'
import { normalizeDashboard } from '@/services/redash/normalize-dashboard'
import type { RedashDashboard, RedashWidget } from '@/services/redash/types'
import type { DashboardEditPayload, DashboardOperation } from './dashboard-changes'
import * as dashboardCalls from './dashboard-node-calls'
import { visibleWidgetCount } from './library-results'
import { abandonPromotion, finishPromotion, type PromotionReceipt } from './promotion-lifecycle'
import type { Draft, ActiveDashboard } from './thread-model'
import type { RedashTransport } from './transport'
import type { ChatPromotion } from './wire'

export type DashboardEditDraft = Draft<DashboardEditPayload>

export interface DraftChart {
  queryId: number
  visualizationId: number
}

export interface DashboardApplyOptions {
  overwrite: boolean
  confirmRemovals: boolean
  promoteDraft?: (queryDraftId: string) => Promise<DraftChart | null>
}

export type DashboardApplyOutcome =
  | { status: 'done'; promotion: ChatPromotion; dashboard: ActiveDashboard | null }
  | { status: 'unsynced'; promotion: ChatPromotion; patch: PromotionPatch; dashboard: ActiveDashboard | null }
  | { status: 'conflict'; promotion?: ChatPromotion }
  | { status: 'failed'; error: string; promotion?: ChatPromotion }

export const CONFIRM_REMOVALS = 'Removing widgets needs a second click to confirm.'
export const NO_SUCH_VERSION = 'This edit has no such version.'

const DASHBOARD_STEP = 0
const MAX_ERROR_CHARS = 500

interface Context {
  transport: RedashTransport
  dashboardId: number
  keyPrefix: string
  expected: (updatedAt: string) => string | undefined
  fresh: Map<number, RedashWidget>
  promoteDraft: DashboardApplyOptions['promoteDraft']
}

interface Written {
  targetId: string
  updatedAt?: string
}

function carriedReceipts(promotions: ChatPromotion[], version: number): Map<number, PromotionReceipt> {
  const earlier = promotions.filter((one) => one.promotedVersion === version && one.status === 'partial').at(-1)
  const carried = new Map<number, PromotionReceipt>()
  for (const receipt of earlier?.receipts ?? []) {
    if (receipt.outcome === 'done') carried.set(receipt.step, receipt)
  }
  return carried
}

function needsFreshRead(operations: DashboardOperation[]): boolean {
  return operations.some((one) => one.op === 'editText' || one.op === 'move')
}

function freshWidget(context: Context, widgetId: number, title: string): RedashWidget {
  const widget = context.fresh.get(widgetId)
  if (!widget) throw new Error(`${title} is no longer on this dashboard.`)
  return widget
}

async function create(
  context: Context,
  index: number,
  visualizationId: number | null,
  text: string | undefined,
  options: dashboardCalls.WidgetOptions
): Promise<Written> {
  const created = await dashboardCalls.createWidget(context.transport, {
    dashboard_id: context.dashboardId,
    visualization_id: visualizationId,
    ...(text === undefined ? {} : { text }),
    options,
    idempotency_key: `${context.keyPrefix}${index + 1}`,
  })
  return { targetId: String(created.id), updatedAt: created.updated_at }
}

async function runOperation(operation: DashboardOperation, index: number, context: Context): Promise<Written> {
  const { transport } = context
  if (operation.op === 'addText') {
    return create(context, index, null, operation.text, { position: operation.position })
  }
  if (operation.op === 'add') {
    const chart =
      operation.queryDraftId !== undefined
        ? await context.promoteDraft?.(operation.queryDraftId)
        : { queryId: operation.queryId ?? 0, visualizationId: operation.visualizationId ?? 0 }
    if (!chart) throw new Error(`${operation.title} could not be created, so it was not added.`)
    return create(context, index, chart.visualizationId, undefined, {
      position: operation.position,
      ...(operation.parameterMappings ? { parameterMappings: operation.parameterMappings } : {}),
    })
  }
  const expected = context.expected(operation.updatedAt)
  if (operation.op === 'remove') {
    await dashboardCalls.deleteWidget(transport, operation.widgetId, expected)
    return { targetId: String(operation.widgetId) }
  }
  const widget = freshWidget(context, operation.widgetId, operation.title)
  const options =
    operation.op === 'move'
      ? { ...widget.options, position: { ...widget.options.position, ...operation.position } }
      : widget.options
  const text = operation.op === 'editText' ? operation.text : widget.text
  const saved = await dashboardCalls.updateWidget(
    transport,
    operation.widgetId,
    { text, width: widget.width ?? 1, options },
    expected
  )
  return { targetId: String(operation.widgetId), updatedAt: saved?.updated_at }
}

function receiptOf(step: number, written: Written): PromotionReceipt {
  return { step, outcome: 'done', targetId: written.targetId, ...(written.updatedAt ? { updatedAt: written.updatedAt } : {}) }
}

async function currentDashboard(
  transport: RedashTransport,
  dashboardId: number
): Promise<{ raw: RedashDashboard | null; active: ActiveDashboard | null }> {
  const raw = await dashboardCalls.getRawDashboard(transport, dashboardId).catch(() => null)
  if (!raw) return { raw: null, active: null }
  const board = normalizeDashboard(raw)
  return { raw, active: { id: board.id, name: board.name, widgetCount: visibleWidgetCount(board) } }
}

export async function applyDashboardEdit(
  draft: DashboardEditDraft,
  version: number,
  transport: RedashTransport,
  options: DashboardApplyOptions
): Promise<DashboardApplyOutcome> {
  const entry = draft.versions.find((one) => one.version === version)
  if (!entry) return { status: 'failed', error: NO_SUCH_VERSION }
  const { dashboardId, snapshot, name, tags, operations } = entry.payload
  if (!options.confirmRemovals && operations.some((one) => one.op === 'remove')) {
    return { status: 'failed', error: CONFIRM_REMOVALS }
  }
  const targetId = String(dashboardId)
  const carried = carriedReceipts(draft.promotions, version)

  let promotion: ChatPromotion
  try {
    promotion = await recordPromotion(draft.id, { version, targetType: 'dashboard', targetId, status: 'pending' })
  } catch (error) {
    return { status: 'failed', error: readQueryError(error).message }
  }

  const receipts: PromotionReceipt[] = []
  let step = DASHBOARD_STEP
  try {
    const dashboardChange = name !== undefined || tags !== undefined
    const landed = carried.get(DASHBOARD_STEP)
    if (landed) {
      receipts.push(landed)
    } else if (dashboardChange) {
      const changes = { ...(name === undefined ? {} : { name }), ...(tags === undefined ? {} : { tags }) }
      const saved = await dashboardCalls.updateDashboard(
        transport,
        dashboardId,
        changes,
        options.overwrite ? undefined : (snapshot.updatedAt ?? undefined)
      )
      receipts.push(receiptOf(DASHBOARD_STEP, { targetId, updatedAt: saved?.updated_at }))
    } else {
      receipts.push({ step: DASHBOARD_STEP, outcome: 'skipped', targetId })
    }
    const read = needsFreshRead(operations) ? await dashboardCalls.getRawDashboard(transport, dashboardId) : null
    const context: Context = {
      transport,
      dashboardId,
      keyPrefix: `${draft.id}:${version}:d${dashboardId}:`,
      expected: (updatedAt) => (options.overwrite ? undefined : updatedAt),
      fresh: new Map((read?.widgets ?? []).map((widget) => [widget.id, widget])),
      promoteDraft: options.promoteDraft,
    }
    for (const [index, operation] of operations.entries()) {
      step = index + 1
      const earlier = carried.get(step)
      receipts.push(earlier ?? receiptOf(step, await runOperation(operation, index, context)))
    }
  } catch (error) {
    const conflict = error instanceof ApiError && error.status === 409
    const landedAny = receipts.some((one) => one.outcome === 'done')
    await abandonPromotion(draft.id, promotion, receipts, step, error, landedAny ? targetId : null)
    const message = readQueryError(error).message
    const abandoned: ChatPromotion = {
      ...promotion,
      status: landedAny ? 'partial' : 'failed',
      ...(landedAny ? { targetId } : {}),
      receipts: [...receipts, { step, outcome: 'failed', error: message.slice(0, MAX_ERROR_CHARS) }],
    }
    return conflict ? { status: 'conflict', promotion: abandoned } : { status: 'failed', error: message, promotion: abandoned }
  }

  const { active } = await currentDashboard(transport, dashboardId)
  const sync = await finishPromotion(draft.id, promotion, targetId, receipts, active?.widgetCount ?? null)
  const dashboard = active ? { ...active, name: name ?? active.name } : null
  return sync.synced
    ? { status: 'done', promotion: sync.promotion, dashboard }
    : { status: 'unsynced', promotion: sync.promotion, patch: sync.patch, dashboard }
}
