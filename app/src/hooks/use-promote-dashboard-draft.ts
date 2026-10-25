'use client'

import { useCallback, useState } from 'react'
import { useWriteProposedQuery } from '@/components/chat/proposal-kit/use-write-proposed-query'
import { calculateNewWidgetPosition, getDefaultSize, type PlacedWidget } from '@/components/dashboard/add-widget-layout'
import { visibleWidgetCount } from '@/lib/chat/library-results'
import {
  abandonPromotion,
  finishPromotion,
  idempotencyKey,
  type PromotionReceipt,
} from '@/lib/chat/promotion-lifecycle'
import type { ActiveDashboard, DashboardDraftView, DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { readQueryError } from '@/lib/query-error'
import { recordPromotion } from '@/services/ai/chat-client'
import * as dashboardsService from '@/services/redash/dashboards'
import { createWidget } from '@/services/redash/widgets'
import { resolveDraftChart, resolveExistingChart, type QueryDraftHold, type QueryPromoted } from './resolve-draft-chart'
import { useUnsyncedRecord } from './use-unsynced-record'

export type DashboardPromoteStatus = 'idle' | 'saving' | 'conflict'

export interface DashboardPromotion {
  status: DashboardPromoteStatus
  error: string | null
  skipped: string[]
  unsynced: boolean
  retrySync: () => void
  save: () => void
  append: (overwrite: boolean) => void
  keep: () => void
}

type DashboardPromoted = (draftId: string, promotion: ChatPromotion) => void
type DashboardActivated = (dashboard: ActiveDashboard) => void

const TEXT_SIZE = { sizeX: 6, sizeY: 4 }
const DASHBOARD_STEP = 0
const FIRST_WIDGET_STEP = 1

type ResolvedItem =
  | { kind: 'chart'; visualizationId: number; visualizationType?: string; step: number }
  | { kind: 'text'; text: string; step: number }

interface Progress {
  receipts: PromotionReceipt[]
  step: number
}

export function usePromoteDashboardDraft(
  draft: DashboardDraftView,
  queryDrafts: Record<string, DraftView>,
  activeDashboard: ActiveDashboard | null,
  onQueryPromoted: QueryPromoted,
  onDashboardPromoted: DashboardPromoted,
  onDashboardActive: DashboardActivated,
  querySync: QueryDraftHold
): DashboardPromotion {
  const { write } = useWriteProposedQuery()
  const [status, setStatus] = useState<DashboardPromoteStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const latest = draft.versions[draft.versions.length - 1]
  const unsynced = useUnsyncedRecord(draft.id, (record) => onDashboardPromoted(draft.id, record))
  const { hold } = unsynced

  const fail = useCallback((cause: unknown) => {
    setError(readQueryError(cause).message)
    setStatus('idle')
  }, [])

  const resolveItems = useCallback(async () => {
    const widgets: ResolvedItem[] = []
    const skippedTitles: string[] = []
    const items = latest?.payload.items ?? []
    for (const [index, item] of items.entries()) {
      const step = FIRST_WIDGET_STEP + index
      if (item.kind === 'text') {
        widgets.push({ kind: 'text', text: item.text, step })
        continue
      }
      const resolved =
        item.kind === 'draft'
          ? await resolveDraftChart(write, queryDrafts[item.queryDraftId], onQueryPromoted, querySync)
          : await resolveExistingChart(item.queryId, item.visualizationId)
      const label = item.title ?? (item.kind === 'draft' ? item.queryDraftId : `query ${item.queryId}`)
      if (resolved && 'visualizationId' in resolved) {
        widgets.push({
          kind: 'chart',
          visualizationId: resolved.visualizationId,
          visualizationType: resolved.visualizationType,
          step,
        })
      } else {
        skippedTitles.push(resolved ? `${label} (${resolved.reason})` : label)
      }
    }
    return { widgets, skippedTitles }
  }, [latest, queryDrafts, write, onQueryPromoted, querySync])

  const writeWidgets = useCallback(
    async (
      dashboardId: number,
      existing: readonly PlacedWidget[],
      widgets: ResolvedItem[],
      progress: Progress,
      keyPrefix: string,
      knownWidgetIds: ReadonlySet<number> = new Set()
    ) => {
      if (!latest) return 0
      const layout = [...existing]
      let charts = 0
      for (const widget of widgets) {
        progress.step = widget.step
        const size = widget.kind === 'text' ? TEXT_SIZE : getDefaultSize(widget.visualizationType ?? '')
        const position = { ...calculateNewWidgetPosition(layout, size.sizeX, size.sizeY), ...size }
        layout.push({ options: { position } })
        const widgetRecord = await createWidget({
          dashboard_id: dashboardId,
          visualization_id: widget.kind === 'chart' ? widget.visualizationId : null,
          ...(widget.kind === 'text' ? { text: widget.text } : {}),
          options: { position },
          idempotency_key: `${keyPrefix}${widget.step}`,
        })
        progress.receipts.push({
          step: widget.step,
          outcome: 'done',
          targetId: String(widgetRecord.id),
          updatedAt: widgetRecord.updated_at,
        })
        if (widget.kind === 'chart' && !knownWidgetIds.has(widgetRecord.id)) charts += 1
      }
      return charts
    },
    [latest]
  )

  const save = useCallback(() => {
    if (!latest) return
    setStatus('saving')
    setError(null)
    setSkipped([])
    const run = async () => {
      const pending = await recordPromotion(draft.id, {
        version: latest.version,
        targetType: 'dashboard',
        status: 'pending',
      })
      const progress: Progress = { receipts: [], step: DASHBOARD_STEP }
      let dashboardId: string | null = null
      try {
        const { widgets, skippedTitles } = await resolveItems()
        const dashboard = await dashboardsService.create({
          name: latest.payload.name,
          idempotency_key: idempotencyKey(draft.id, latest.version, DASHBOARD_STEP),
        })
        dashboardId = String(dashboard.id)
        progress.receipts.push({
          step: DASHBOARD_STEP,
          outcome: 'done',
          targetId: dashboardId,
          updatedAt: dashboard.updated_at,
        })
        const created = await writeWidgets(dashboard.id, [], widgets, progress, `${draft.id}:${latest.version}:`)
        const sync = await finishPromotion(draft.id, pending, dashboardId, progress.receipts, created)
        if (sync.synced) onDashboardPromoted(draft.id, sync.promotion)
        else hold(sync.promotion, sync.patch)
        onDashboardActive({ id: dashboard.id, name: dashboard.name, widgetCount: created })
        setSkipped(skippedTitles)
        setStatus('idle')
      } catch (cause) {
        await abandonPromotion(draft.id, pending, progress.receipts, progress.step, cause, dashboardId)
        throw cause
      }
    }
    run().catch(fail)
  }, [latest, resolveItems, writeWidgets, draft.id, onDashboardPromoted, onDashboardActive, hold, fail])

  const append = useCallback(
    (overwrite: boolean) => {
      if (!latest || !activeDashboard) return
      setStatus('saving')
      setError(null)
      setSkipped([])
      const run = async () => {
        const current = await dashboardsService.get(activeDashboard.id)
        if (!current) {
          setError('This dashboard no longer exists.')
          setStatus('idle')
          return
        }
        const currentCount = visibleWidgetCount(current)
        if (currentCount !== activeDashboard.widgetCount && !overwrite) {
          setStatus('conflict')
          return
        }
        const targetId = String(activeDashboard.id)
        const pending = await recordPromotion(draft.id, {
          version: latest.version,
          targetType: 'dashboard',
          targetId,
          status: 'pending',
        })
        const progress: Progress = {
          receipts: [{ step: DASHBOARD_STEP, outcome: 'skipped', targetId }],
          step: DASHBOARD_STEP,
        }
        try {
          const { widgets, skippedTitles } = await resolveItems()
          const created = await writeWidgets(
            activeDashboard.id,
            current.widgets,
            widgets,
            progress,
            `${draft.id}:${latest.version}:d${activeDashboard.id}:`,
            new Set(current.widgets.map((widget) => widget.id))
          )
          const widgetCount = currentCount + created
          const sync = await finishPromotion(draft.id, pending, targetId, progress.receipts, widgetCount)
          if (sync.synced) onDashboardPromoted(draft.id, sync.promotion)
          else hold(sync.promotion, sync.patch)
          onDashboardActive({ id: activeDashboard.id, name: activeDashboard.name, widgetCount })
          setSkipped(skippedTitles)
          setStatus('idle')
        } catch (cause) {
          await abandonPromotion(draft.id, pending, progress.receipts, progress.step, cause, targetId)
          throw cause
        }
      }
      run().catch(fail)
    },
    [latest, activeDashboard, resolveItems, writeWidgets, draft.id, onDashboardPromoted, onDashboardActive, hold, fail]
  )

  const keep = useCallback(() => setStatus('idle'), [])

  return { status, error, skipped, unsynced: unsynced.held, retrySync: unsynced.retry, save, append, keep }
}
