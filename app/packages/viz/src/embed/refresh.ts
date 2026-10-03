export const MIN_REFRESH_SECONDS = 15
export const MAX_REFRESH_SECONDS = 3600

export function clampRefreshSeconds(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  return Math.min(Math.max(Math.round(seconds), MIN_REFRESH_SECONDS), MAX_REFRESH_SECONDS)
}

export function refreshIntervalMs(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value
  if (!text) return null
  const seconds = clampRefreshSeconds(Number(text))
  return seconds == null ? null : seconds * 1000
}
