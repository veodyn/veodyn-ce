/**
 * Redash API client — mirrors client/app/services/axios.js
 *
 * All requests go through the Next.js proxy at /api/node/*,
 * which forwards cookies and CSRF tokens to the real Redash backend.
 *
 * Features:
 * - CSRF token handling (reads from cookie, sends as header)
 * - Session refresh on 401 (redirects to login)
 * - API key support for embed/public access
 * - Automatic JSON parsing
 */

let apiKey: string | null = null

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/csrf_token=([^;]+)/)
  return match ? match[1] : null
}

interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined | Array<string | number>>
  data?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<T = unknown>(
  method: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  // Build URL through the proxy
  const url = new URL(`/api/node/${path}`, window.location.origin)

  // Add query params
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        // Repeated params, e.g. ?tags=a&tags=b (Redash list filtering)
        for (const v of value) url.searchParams.append(key, String(v))
      } else {
        url.searchParams.set(key, String(value))
      }
    }
  }

  // Build headers — mirrors axios.js interceptors
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  // CSRF token — mirrors xsrfCookieName/xsrfHeaderName config
  const csrf = getCsrfToken()
  if (csrf) {
    headers['X-CSRF-TOKEN'] = csrf
  }

  // API key auth — mirrors Auth.getApiKey() interceptor
  if (apiKey) {
    headers['Authorization'] = `Key ${apiKey}`
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'include', // Send cookies
    signal: options.signal,
  }

  if (options.data && method !== 'GET') {
    fetchOptions.body = JSON.stringify(options.data)
  }

  const response = await fetch(url.toString(), fetchOptions)

  // Handle CSRF refresh — mirrors csrfRefreshInterceptor
  if (response.status === 400) {
    const text = await response.text()
    if (text.includes('CSRF')) {
      // Refresh CSRF token by hitting /ping
      await fetch('/api/node/ping', { credentials: 'include' })
      // Retry the original request
      return request(method, path, options)
    }
    throw new ApiError(400, errorMessage(text, 400))
  }

  // Handle session expiry — mirrors sessionRefreshInterceptor.
  // Never redirect in API-key (embed/public) mode: those pages have no
  // session to restore and a redirect would loop.
  if (response.status === 401) {
    if (typeof window !== 'undefined' && path !== 'session' && !apiKey) {
      window.location.href = '/?session_expired=1'
    }
    throw new ApiError(401, 'Session expired')
  }

  // Version conflict on queries/dashboards (stale `version` sent)
  if (response.status === 409) {
    throw new ApiError(
      409,
      'This item was changed by someone else since you loaded it. Reload the page and re-apply your changes.'
    )
  }

  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(await response.text(), response.status))
  }

  // A null-body success has nothing to parse. 204 and 205 are `ok`, so they
  // fall past every branch above and used to reach .json(), which throws
  // `SyntaxError: Unexpected end of JSON input` on an empty body. Redash
  // answers DELETE /data_sources/:id and DELETE /destinations/:id with
  // make_response("", 204), so the delete rejected, the mutation's onSuccess
  // never fired, and the deleted row stayed on screen until a reload.
  //
  // 304 is deliberately not in this list: it is not `ok`, so the !response.ok
  // branch above already turns it into an ApiError. Folding it in here would
  // convert a stale-cache answer into an undefined that callers typed to
  // expect a body would silently read as a successful empty result.
  if (response.status === 204 || response.status === 205) {
    // `undefined as T` rather than widening the signature to `T | undefined`:
    // the endpoints that answer 204 are the ones whose callers discard the
    // value (deleteDataSource is `Promise<void>`), so every other caller keeps
    // its exact `T` and no call site needs a cast.
    return undefined as T
  }

  // Mirrors axios interceptor: response => response.data
  return response.json()
}

/**
 * Turns an error response body into something worth showing a person.
 * Redash answers with `{"message": "..."}`, and throwing the raw body meant
 * that JSON envelope was rendered verbatim in error panels and toasts.
 */
function errorMessage(body: string, status: number): string {
  const trimmed = body.trim()
  if (trimmed) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        const { message, error } = parsed as { message?: unknown; error?: unknown }
        if (typeof message === 'string' && message.trim()) return message.trim()
        if (typeof error === 'string' && error.trim()) return error.trim()
      }
    } catch {
      // Not JSON. The body is already the message.
    }
    return trimmed
  }
  return `Request failed (${status})`
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

// Public API — matches the original axios instance methods
export const redashApi = {
  get: <T = unknown>(path: string, options?: RequestOptions) =>
    request<T>('GET', path, options),

  post: <T = unknown>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, data }),

  put: <T = unknown>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, data }),

  delete: <T = unknown>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, options),

  patch: <T = unknown>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, data }),

  setApiKey: (key: string | null) => {
    apiKey = key
  },

  getApiKey: () => apiKey,
}
