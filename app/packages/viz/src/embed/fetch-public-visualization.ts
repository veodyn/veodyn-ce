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
