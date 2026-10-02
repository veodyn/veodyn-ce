'use client'

import { useCallback, useState } from 'react'
import { useWriteProposedQuery } from '@/components/ai/create-chat/proposals/use-write-proposed-query'
import { pickVisualization, visibleWidgetCount } from '@/lib/chat/library-results'
import type { ActiveDashboard, DashboardDraftView, DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { readQueryError } from '@/lib/query-error'
import { recordPromotion } from '@/services/ai/chat-client'
import * as dashboardsService from '@/services/redash/dashboards'
import * as queriesService from '@/services/redash/queries'
import { createWidget } from '@/services/redash/widgets'
import { promoteQueryDraft } from './promote-query-draft'

export type DashboardPromoteStatus = 'idle' | 'saving' | 'conflict'

export interface DashboardPromotion {
  status: DashboardPromoteStatus
  error: string | null
  skipped: string[]
  save: () => void
  append: (overwrite: boolean) => void
  keep: () => void
}

type QueryPromoted = (draftId: string, promotion: ChatPromotion) => void
type DashboardPromoted = (draftId: string, promotion: ChatPromotion) => void
type DashboardActivated = (dashboard: ActiveDashboard) => void

const WIDGET_SIZE = { sizeX: 3, sizeY: 8 }

interface ResolvedItem {
  visualizationId: number
  title?: string
}

async function resolveDraftItem(
  write: ReturnType<typeof useWriteProposedQuery>['write'],
  queryDraft: DraftView | undefined,
  onQueryPromoted: QueryPromoted
): Promise<ResolvedItem | null> {
  if (!queryDraft) return null
  const promoted = queryDraft.promotions[queryDraft.promotions.length - 1]
  if (promoted) {
    const query = await queriesService.get(Number(promoted.targetId)).catch(() => null)
    if (!query) return null
    const visualization = pickVisualization(query, null)
    return typeof visualization === 'string' ? null : { visualizationId: visualization.id }
  }
  const written = await promoteQueryDraft(write, queryDraft)
  onQueryPromoted(queryDraft.id, written.promotion)
  return written.visualizationId === null ? null : { visualizationId: written.visualizationId }
}

async function resolveExistingItem(queryId: number, visualizationId: number): Promise<ResolvedItem | null> {
  const query = await queriesService.get(queryId).catch(() => null)
  const found = query?.visualizations.find((one) => one.id === visualizationId)
  return found ? { visualizationId } : null
}

export function usePromoteDashboardDraft(
  draft: DashboardDraftView,
  queryDrafts: Record<string, DraftView>,
  activeDashboard: ActiveDashboard | null,
  onQueryPromoted: QueryPromoted,
  onDashboardPromoted: DashboardPromoted,
  onDashboardActive: DashboardActivated
): DashboardPromotion {
  const { write } = useWriteProposedQuery()
  const [status, setStatus] = useState<DashboardPromoteStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const latest = draft.versions[draft.versions.length - 1]

  const fail = useCallback((cause: unknown) => {
    setError(readQueryError(cause).message)
    setStatus('idle')
  }, [])

  const resolveItems = useCallback(async () => {
    const widgets: ResolvedItem[] = []
    const skippedTitles: string[] = []
    for (const item of latest?.payload.items ?? []) {
      const resolved =
        item.kind === 'draft'
          ? await resolveDraftItem(write, queryDrafts[item.queryDraftId], onQueryPromoted)
          : await resolveExistingItem(item.queryId, item.visualizationId)
      if (resolved) widgets.push({ ...resolved, title: item.title })
      else skippedTitles.push(item.title ?? (item.kind === 'draft' ? item.queryDraftId : `query ${item.queryId}`))
    }
    return { widgets, skippedTitles }
  }, [latest, queryDrafts, write, onQueryPromoted])

  const writeWidgets = useCallback(async (dashboardId: number, startIndex: number, widgets: ResolvedItem[]) => {
    let created = 0
    for (const widget of widgets) {
      await createWidget({
        dashboard_id: dashboardId,
        visualization_id: widget.visualizationId,
        options: { position: { col: 0, row: (startIndex + created) * WIDGET_SIZE.sizeY, ...WIDGET_SIZE } },
      })
      created += 1
    }
    return created
  }, [])

  const save = useCallback(() => {
    if (!latest) return
    setStatus('saving')
    setError(null)
    setSkipped([])
    const run = async () => {
      const { widgets, skippedTitles } = await resolveItems()
      const dashboard = await dashboardsService.create({ name: latest.payload.name })
      const created = await writeWidgets(dashboard.id, 0, widgets)
      const promotion = await recordPromotion(draft.id, {
        version: latest.version,
        targetType: 'dashboard',
        targetId: String(dashboard.id),
        targetVersionAtPromote: created,
      })
      onDashboardPromoted(draft.id, promotion)
      onDashboardActive({ id: dashboard.id, name: dashboard.name, widgetCount: created })
      setSkipped(skippedTitles)
      setStatus('idle')
    }
    run().catch(fail)
  }, [latest, resolveItems, writeWidgets, draft.id, onDashboardPromoted, onDashboardActive, fail])

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
        const { widgets, skippedTitles } = await resolveItems()
        const created = await writeWidgets(activeDashboard.id, currentCount, widgets)
        const widgetCount = currentCount + created
        const promotion = await recordPromotion(draft.id, {
          version: latest.version,
          targetType: 'dashboard',
          targetId: String(activeDashboard.id),
          targetVersionAtPromote: widgetCount,
        })
        onDashboardPromoted(draft.id, promotion)
        onDashboardActive({ id: activeDashboard.id, name: activeDashboard.name, widgetCount })
        setSkipped(skippedTitles)
        setStatus('idle')
      }
      run().catch(fail)
    },
    [latest, activeDashboard, resolveItems, writeWidgets, draft.id, onDashboardPromoted, onDashboardActive, fail]
  )

  const keep = useCallback(() => setStatus('idle'), [])

  return { status, error, skipped, save, append, keep }
}
