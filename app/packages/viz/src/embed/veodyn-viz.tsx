'use client'

import { useQuery } from '@tanstack/react-query'
import type { CSSProperties, ReactNode } from 'react'
import { CHART_FILL_VAR } from '../lib/chart-marks'
import { PUBLIC_VISUALIZATION_ID } from '../lib/public-visualization'
import { visualizationData } from '../lib/visualizations/data-gate'
import { VisualizationErrorBoundary } from '../components/visualizations/visualization-error-boundary'
import { VisualizationRenderer } from '../components/visualizations/visualization-renderer'
import { fetchPublicVisualization } from './fetch-public-visualization'
import { clampRefreshSeconds } from './refresh'
import { useVeodyn } from './veodyn-context'

export interface VeodynVizProps {
  token: string
  refreshSeconds?: number
  className?: string
  style?: CSSProperties
  renderLoading?: () => ReactNode
  renderUnavailable?: () => ReactNode
}

function DefaultLoading() {
  return <div role="status" aria-label="Loading visualization" data-veodyn-part="loading" />
}

function DefaultUnavailable() {
  return <p data-veodyn-part="unavailable">This visualization is no longer available.</p>
}

export function VeodynViz({ token, refreshSeconds, className, style, renderLoading, renderUnavailable }: VeodynVizProps) {
  const { baseUrl } = useVeodyn()
  const refresh = clampRefreshSeconds(refreshSeconds)
  const { data: payload, isLoading } = useQuery({
    queryKey: ['veodyn-public-visualization', baseUrl, token],
    queryFn: ({ signal }) => fetchPublicVisualization(baseUrl, token, signal),
    retry: false,
    refetchInterval: refresh == null ? false : refresh * 1000,
  })

  const data = payload ? visualizationData(payload.visualization.type, payload.data) : null

  let body: ReactNode
  if (isLoading) body = renderLoading ? renderLoading() : <DefaultLoading />
  else if (!payload || !data) body = renderUnavailable ? renderUnavailable() : <DefaultUnavailable />
  else
    body = (
      <VisualizationErrorBoundary>
        <VisualizationRenderer
          visualization={{ ...payload.visualization, id: PUBLIC_VISUALIZATION_ID, created_at: '', updated_at: '' }}
          data={data}
        />
      </VisualizationErrorBoundary>
    )

  return (
    <div
      data-veodyn-part="root"
      role="figure"
      aria-label={payload?.visualization.name || undefined}
      className={className}
      style={{ [CHART_FILL_VAR]: '100%', ...style } as CSSProperties}
    >
      {body}
    </div>
  )
}
