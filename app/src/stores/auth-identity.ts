// Identity shapes and the pure functions that build them, split out of
// auth-store so the store file holds the state machine and nothing else.
//
// Everything here is side-effect free except the two browser helpers at the
// bottom, which are the store's only durable client state: the mock session
// cookie and the signed-out marker.

import type { MockUser } from '@/lib/mock-data'

// ─── Permission types (mirrors Redash Group model) ──────────────────────────
export type Permission =
  | 'admin'
  | 'super_admin'
  | 'list_users'
  | 'create_query'
  | 'edit_query'
  | 'view_query'
  | 'view_source'
  | 'execute_query'
  | 'list_dashboards'
  | 'create_dashboard'
  | 'edit_dashboard'
  | 'list_alerts'
  | 'list_data_sources'
  | 'schedule_query'
  | 'publish_report'
  // External publishing. Like publish_report these belong to this product, not
  // to Redash, so no built-in group carries them and an admin qualifies by
  // being an admin (see buildPolicy).
  | 'publish_dashboard'
  | 'publish_visualization'
  // A DENY flag, and the only one in this union. Everything else here grants;
  // this one takes export away from a group that carries it. See policy.ts for
  // why it is inverted.
  | 'no_export_data'

// ─── CurrentUser (mirrors client/app/services/auth.js currentUser object) ───
export interface CurrentUser extends MockUser {
  permissions: Permission[]
  isAdmin: boolean
  hasPermission: (permission: Permission) => boolean
  canEdit: (object: { user_id?: number; user?: { id: number } }) => boolean
  canCreate: () => boolean
}

// ─── ClientConfig (mirrors handlers/authentication.py client_config()) ──────
export interface ClientConfig {
  allowScriptsInUserInput: boolean
  showPermissionsControl: boolean
  allowCustomJSVisualizations: boolean
  autoPublishNamedQueries: boolean
  disablePublicUrls: boolean
  dateFormat: string
  dateTimeFormat: string
  floatFormat: string
  integerFormat: string
  mailSettingsMissing: boolean
  dashboardRefreshIntervals: number[]
  queryRefreshIntervals: number[]
  pageSize: number
  pageSizeOptions: number[]
}

// ─── The server-read session, as it travels to the client ───────────────────
// Declared here rather than beside the reader in src/lib/server-session.ts so
// the store can name it without a type-only import into a module whose runtime
// half pulls next/headers and the server env boundary.

/** Exactly what Redash's GET /api/session answers, and what the store consumes. */
export interface SessionPayload {
  user: Record<string, unknown>
  client_config: Partial<ClientConfig>
  messages: string[]
  org_name?: string
  org_slug?: string
}

/**
 * What the server managed to decide about this request, as a serializable prop.
 *
 * `null` is its own answer and not a synonym for anonymous: it means this
 * render could not decide, so the client keeps the old behaviour and asks for
 * itself. Mock mode is the ordinary case (there is no backend to ask), a public
 * route is the second, and a backend unreachable from the server is the third.
 *
 * What `null` does NOT do, despite reading like it should: rescue a signed-in
 * reader from an outage. The client fallback it defers to is `loadSession`,
 * which maps every non-OK response to signed-out, so two consecutive Redash
 * 500s still end at /login. `null` keeps this layer from ASSERTING something it
 * cannot know; making the outage case degrade properly means teaching
 * loadSession to tell 5xx from 401, which is a product decision about what an
 * unreachable backend should look like and is not made here.
 */
export type InitialSession =
  | { status: 'authenticated'; payload: SessionPayload; needsApiKeyHeal: boolean }
  | { status: 'anonymous' }
  | null

export function buildCurrentUser(raw: Record<string, unknown>): CurrentUser {
  const permissions = (raw.permissions as Permission[]) || []
  const isAdmin = permissions.includes('admin')
  const user: CurrentUser = {
    id: raw.id as number,
    name: raw.name as string,
    email: raw.email as string,
    profile_image_url: (raw.profile_image_url as string) || '',
    groups: (raw.groups as number[]) || [],
    api_key: (raw.api_key as string) || '',
    created_at: (raw.created_at as string) || '',
    updated_at: (raw.updated_at as string) || '',
    is_disabled: (raw.is_disabled as boolean) || false,
    is_invitation_pending: (raw.is_invitation_pending as boolean) || false,
    active_at: (raw.active_at as string) || '',
    is_email_verified: (raw.is_email_verified as boolean) || true,
    auth_type: (raw.auth_type as string) || 'password',
    permissions,
    isAdmin,
    hasPermission: (permission: Permission) => permissions.includes(permission),
    canEdit: (object) => {
      if (isAdmin) return true
      const ownerId = object.user_id ?? object.user?.id
      return ownerId === (raw.id as number)
    },
    canCreate: () =>
      permissions.includes('create_query') ||
      permissions.includes('create_dashboard') ||
      permissions.includes('list_alerts'),
  }
  return user
}

// ─── Mock helpers ───────────────────────────────────────────────────────────
// Deliberately WITHOUT publish_report. Redash's built-in admin group carries a
// fixed list that will never contain it, because publish_report belongs to this
// product rather than to Redash: an admin publishes by being an admin, which is
// the rule `buildPolicy` and the server both apply. Granting it here made the
// mock admin the one account that could not reproduce what every real admin
// saw, which is how a Publishing panel that refused its own admin shipped.
const ADMIN_PERMISSIONS: Permission[] = [
  'admin', 'super_admin', 'list_users', 'create_query', 'edit_query',
  'view_query', 'view_source', 'execute_query', 'list_dashboards',
  'create_dashboard', 'edit_dashboard', 'list_alerts', 'list_data_sources',
  'schedule_query',
]
const DEFAULT_PERMISSIONS: Permission[] = [
  'create_query', 'edit_query', 'view_query', 'view_source',
  'execute_query', 'list_dashboards', 'create_dashboard', 'edit_dashboard',
  'list_alerts', 'list_data_sources', 'schedule_query',
]
const READONLY_PERMISSIONS: Permission[] = [
  'view_query', 'list_dashboards', 'list_alerts',
]

function getPermissionsForGroups(groupIds: number[]): Permission[] {
  const perms = new Set<Permission>()
  for (const gid of groupIds) {
    const set = gid === 1 ? ADMIN_PERMISSIONS : gid === 2 ? DEFAULT_PERMISSIONS : READONLY_PERMISSIONS
    for (const p of set) perms.add(p)
  }
  return Array.from(perms)
}

export function buildMockCurrentUser(user: MockUser): CurrentUser {
  const permissions = getPermissionsForGroups(user.groups)
  return buildCurrentUser({ ...user, permissions })
}

// ─── Defaults ───────────────────────────────────────────────────────────────
export const defaultClientConfig: ClientConfig = {
  allowScriptsInUserInput: false,
  showPermissionsControl: true,
  allowCustomJSVisualizations: false,
  autoPublishNamedQueries: true,
  disablePublicUrls: false,
  dateFormat: 'MM/DD/YY',
  dateTimeFormat: 'MM/DD/YY HH:mm',
  floatFormat: '0,0.00',
  integerFormat: '0,0',
  mailSettingsMissing: false,
  dashboardRefreshIntervals: [60, 300, 600, 1800, 3600, 43200, 86400],
  queryRefreshIntervals: [60, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 18000, 21600, 43200, 86400, 604800],
  pageSize: 25,
  pageSizeOptions: [5, 10, 20, 25, 50, 100, 250],
}

// ─── Durable client state ───────────────────────────────────────────────────
// Mock mode has no backend, so login is client-only and sets no server cookie.
// Same-origin API routes that must recognise a signed-in caller (the AI relay
// authenticates before it will run, even in demo mode) still need a marker, so
// the demo session drops a plain `session` cookie the server can see. It is
// inert for every other route: in mock mode they either 503 or are never
// called.
const MOCK_SESSION_COOKIE = 'session=mock-demo-session'

export function setMockSession(present: boolean) {
  if (typeof document === 'undefined') return
  document.cookie = present
    ? `${MOCK_SESSION_COOKIE}; path=/; SameSite=Lax`
    : 'session=; path=/; Max-Age=0; SameSite=Lax'
}

// A first visit in mock mode signs itself in: that is the point of a demo that
// needs no backend. A deliberate Sign Out is different, and used not to be
// honoured at all, because loadSession() ran again on the next navigation and
// handed back the same admin identity. This marker is what tells those two
// cases apart, and it survives a reload, because the reload undoing the sign
// out was the complaint.
const SIGNED_OUT_KEY = 'veodyn.signed-out'

export function readSignedOut(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SIGNED_OUT_KEY) === '1'
  } catch {
    // Private browsing and blocked storage: fall back to signing in, which is
    // the demo's normal state, rather than locking the user out of a mock app
    // whose sign-in screen accepts anything.
    return false
  }
}

export function writeSignedOut(signedOut: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (signedOut) window.localStorage.setItem(SIGNED_OUT_KEY, '1')
    else window.localStorage.removeItem(SIGNED_OUT_KEY)
  } catch {
    // Same reasoning as readSignedOut: storage is a convenience here, not a
    // security boundary. Mock mode has no secrets to protect.
  }
}
