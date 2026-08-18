// Identity shapes and the pure functions that build them, split out of
// auth-store. Everything here is side-effect free except the two browser helpers
// at the bottom, which are the store's only durable client state.

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
  // External publishing. Like publish_report these belong to this product, so no
  // built-in group carries them and an admin qualifies by being an admin (see
  // buildPolicy).
  | 'publish_dashboard'
  | 'publish_visualization'
  // A DENY flag, and the only one in this union: it takes export away from a
  // group that carries it. See policy.ts.
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
// Declared here rather than beside the reader in src/lib/server-session.ts, whose
// runtime half pulls next/headers and the server env boundary.

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
 * `null` is its own answer and not a synonym for anonymous: this render could not
 * decide, so the client asks for itself. Mock mode is the ordinary case (no
 * backend to ask), a public route the second, a server-side unreachable backend
 * the third.
 *
 * It does NOT rescue a signed-in reader from an outage: the client fallback is
 * `loadSession`, which maps every non-OK response to signed-out, so two
 * consecutive Redash 500s still end at /login.
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
// WITHOUT publish_report: Redash's built-in admin group carries a fixed list that
// will never contain it, and an admin publishes by being an admin, the rule
// `buildPolicy` and the server both apply. Granting it here made the mock admin
// the one account that could not reproduce what every real admin saw.
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
// authenticates even in demo mode) still need a marker, so the demo session drops
// a plain `session` cookie the server can see.
const MOCK_SESSION_COOKIE = 'session=mock-demo-session'

export function setMockSession(present: boolean) {
  if (typeof document === 'undefined') return
  document.cookie = present
    ? `${MOCK_SESSION_COOKIE}; path=/; SameSite=Lax`
    : 'session=; path=/; Max-Age=0; SameSite=Lax'
}

// A first visit in mock mode signs itself in, which is the point of a demo that
// needs no backend. This marker is what tells a deliberate Sign Out apart from
// that, and it survives a reload: without it loadSession() runs again on the next
// navigation and hands back the same admin identity.
const SIGNED_OUT_KEY = 'veodyn.signed-out'

export function readSignedOut(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SIGNED_OUT_KEY) === '1'
  } catch {
    // Private browsing and blocked storage: fall back to signing in, the demo's
    // normal state, rather than locking the user out.
    return false
  }
}

export function writeSignedOut(signedOut: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (signedOut) window.localStorage.setItem(SIGNED_OUT_KEY, '1')
    else window.localStorage.removeItem(SIGNED_OUT_KEY)
  } catch {
    // Same reasoning as readSignedOut: storage is a convenience, not a security
    // boundary.
  }
}
