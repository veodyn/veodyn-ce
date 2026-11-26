'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as widgetsService from '@/services/redash/widgets'
import type { MockDashboardWidget } from '@/lib/mock-data'

export function useCreateWidget() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationKey: ['widget-create'],
    mutationFn: async ({
      dashboardId,
      ...widgetData
    }: Partial<MockDashboardWidget> & { dashboardId: number }) => {
      const options = widgetData.options || {
        position: { col: 0, row: 0, sizeX: 3, sizeY: 8 },
      }
      if (USE_REAL_API) {
        return widgetsService.createWidget({
          dashboard_id: dashboardId,
          // Must be present — null for text widgets
          visualization_id: widgetData.visualization?.id ?? null,
          text: widgetData.text,
          width: widgetData.width || 1,
          options,
        })
      }
      const dashboard = store.dashboards.find((d) => d.id === dashboardId)
      if (!dashboard) throw new Error('Dashboard not found')
      const widget: MockDashboardWidget = {
        id: Date.now(),
        dashboard_id: dashboardId,
        visualization: widgetData.visualization,
        text: widgetData.text,
        width: widgetData.width || 1,
        options,
      }
      store.updateDashboard(dashboardId, {
        widgets: [...dashboard.widgets, widget],
      })
      return widget
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', vars.dashboardId] })
    },
  })
}

export function useUpdateWidget() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationKey: ['widget-update'],
    mutationFn: async ({
      dashboardId,
      widgetId,
      ...updates
    }: Partial<MockDashboardWidget> & { dashboardId: number; widgetId: number }) => {
      if (USE_REAL_API) {
        if (!updates.options) {
          throw new Error('Widget updates must include the full options object')
        }
        return widgetsService.updateWidget(widgetId, {
          text: updates.text,
          width: updates.width,
          options: updates.options,
        })
      }
      const dashboard = store.dashboards.find((d) => d.id === dashboardId)
      if (!dashboard) throw new Error('Dashboard not found')
      store.updateDashboard(dashboardId, {
        widgets: dashboard.widgets.map((w) =>
          w.id === widgetId ? { ...w, ...updates } : w
        ),
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', vars.dashboardId] })
    },
  })
}

export function useDeleteWidget() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationKey: ['widget-delete'],
    mutationFn: async ({
      dashboardId,
      widgetId,
    }: {
      dashboardId: number
      widgetId: number
    }) => {
      if (USE_REAL_API) {
        return widgetsService.deleteWidget(widgetId)
      }
      const dashboard = store.dashboards.find((d) => d.id === dashboardId)
      if (!dashboard) throw new Error('Dashboard not found')
      store.updateDashboard(dashboardId, {
        widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', vars.dashboardId] })
    },
  })
}

export function useSaveLayout() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationKey: ['widget-layout'],
    mutationFn: async ({
      dashboardId,
      widgets,
    }: {
      dashboardId: number
      widgets: MockDashboardWidget[]
    }) => {
      if (USE_REAL_API) {
        await Promise.all(
          widgets.map((w) =>
            widgetsService.updateWidget(w.id, {
              text: w.text,
              width: w.width,
              options: w.options,
            })
          )
        )
        return
      }
      const dashboard = store.dashboards.find((d) => d.id === dashboardId)
      if (!dashboard) throw new Error('Dashboard not found')
      const moved = new Map(widgets.map((w) => [w.id, w]))
      store.updateDashboard(dashboardId, {
        widgets: dashboard.widgets.map((w) => moved.get(w.id) ?? w),
      })
    },
    onSettled: (_, __, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', vars.dashboardId] })
    },
  })
}
