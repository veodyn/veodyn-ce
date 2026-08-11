// Typed event names. No magic strings at call sites, so renaming an event is a
// compile error rather than a silent gap in a dashboard.
export const EVENTS = {
  errorShown: 'app_error_shown',
  queryFailed: 'query_failed',
  vizRenderFailed: 'viz_render_failed',
  consoleForward: 'client_console',
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

// Registered as a super-property on every event. The PostHog instance is shared
// with warpdrive (an unlicensed instance is capped at one project), so this is
// what separates the two streams in every query and replay filter.
export const APP_NAME = 'veodyn'
