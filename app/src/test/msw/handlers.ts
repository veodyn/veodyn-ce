import { http, HttpResponse } from 'msw'

// Default happy-path handlers for the same-origin proxy. Individual tests
// override these with server.use(...) for error/edge cases.
export const handlers = [
  http.get('/api/auth/session', () =>
    HttpResponse.json({ user: { id: 1, name: 'Test User', permissions: ['admin'] } })
  ),
  http.get('/api/node/*', () => HttpResponse.json({})),
  http.post('/api/node/*', () => HttpResponse.json({})),
]
