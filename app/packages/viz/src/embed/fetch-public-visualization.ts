import { normalizePublicVisualization, type PublicVisualizationPayload } from '../lib/public-visualization'

export function publicVisualizationUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/public/visualizations/${encodeURIComponent(token)}`
}

export async function fetchPublicVisualization(
  baseUrl: string,
  token: string,
  signal?: AbortSignal
): Promise<PublicVisualizationPayload | null> {
  const response = await fetch(publicVisualizationUrl(baseUrl, token), {
    credentials: 'omit',
    signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return null
  return normalizePublicVisualization(await response.json())
}
