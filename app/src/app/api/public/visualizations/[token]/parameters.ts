const PARAMETER_KEY = /^p_[A-Za-z0-9_]{1,64}$/
const MAX_PARAMETERS = 10
const MAX_VALUE_LENGTH = 200

export function publicParameterQuery(searchParams: URLSearchParams): string | null {
  const keys = [...new Set([...searchParams.keys()].filter((key) => key.startsWith('p_')))]
  if (keys.length === 0) return ''
  if (keys.length > MAX_PARAMETERS) return null

  const pairs: [string, string][] = []
  for (const key of keys.sort()) {
    const values = searchParams.getAll(key)
    const value = values[0] ?? ''
    if (values.length !== 1 || !PARAMETER_KEY.test(key) || value.length > MAX_VALUE_LENGTH) return null
    pairs.push([key, value])
  }
  return `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
}
