import { publicDashboardWidgetUrl } from '../lib/public-dashboard'
import { publicParameterSearch, readPublicResponse, type PublicParameters, type PublicVisualizationResult } from './public-request'

export function publicVisualizationUrl(baseUrl: string, token: string, parameters?: PublicParameters): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/public/visualizations/${encodeURIComponent(token)}${publicParameterSearch(parameters)}`
}

export async function fetchPublicVisualization(
  baseUrl: string,
  token: string,
  parameters?: PublicParameters,
  signal?: AbortSignal
): Promise<PublicVisualizationResult | null> {
  const response = await fetch(publicVisualizationUrl(baseUrl, token, parameters), {
    credentials: 'omit',
    signal,
    headers: { accept: 'application/json' },
  })
  return readPublicResponse(response)
}

export async function fetchPublicDashboardWidget(
  baseUrl: string,
  dashboardToken: string,
  widgetId: number,
  parameters?: PublicParameters,
  signal?: AbortSignal
): Promise<PublicVisualizationResult | null> {
  const response = await fetch(`${publicDashboardWidgetUrl(baseUrl, dashboardToken, widgetId)}${publicParameterSearch(parameters)}`, {
    credentials: 'omit',
    signal,
    headers: { accept: 'application/json' },
  })
  return readPublicResponse(response)
}
