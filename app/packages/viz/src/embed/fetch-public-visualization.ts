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
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Shared visualization request failed with status ${response.status}`)
  return normalizePublicVisualization(await response.json())
}
