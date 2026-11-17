const TOKEN_ROUTE_PREFIXES: readonly string[] = [
  '/invite/',
  '/reset/',
  '/verify/',
  '/embed/public/',
  '/dashboards/public/',
]

const TOKEN_PLACEHOLDER = '[token]'
const UNUSED_BASE = 'http://base.invalid'

export function redactPath(path: string): string {
  for (const prefix of TOKEN_ROUTE_PREFIXES) {
    if (path.startsWith(prefix) && path.length > prefix.length) {
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf('/')
      return prefix + TOKEN_PLACEHOLDER + (slash === -1 ? '' : rest.slice(slash))
    }
  }
  return path
}

export function redactUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value, UNUSED_BASE)
  } catch {
    return value
  }
  const redacted = redactPath(url.pathname)
  if (redacted === url.pathname) return value
  if (url.origin === UNUSED_BASE) return redacted + url.search
  return url.origin + redacted + url.search
}
