import { useAuthStore, type CurrentUser } from '@/stores/auth-store'

// Mirrors Redash's services/policy/DefaultPolicy.js
// Centralized permission checks used by components.
//
// This is UX gating ONLY (hiding buttons/nav). Actual enforcement happens
// server-side: the /api/node proxy forwards the caller's own session
// cookie so Redash applies per-user permissions to every request, and the
// /api/admin/* routes verify the caller's session carries the permission
// Redash itself puts on the endpoint before using the internal API key
// (INTERNAL_KEY_ENDPOINTS in src/lib/redash-server.ts). canViewAdminStatus
// below asks for super_admin because those endpoints do; the two have to
// agree, and the server side is the one that counts.

export function usePolicy() {
  const currentUser = useAuthStore((s) => s.currentUser)
  return buildPolicy(currentUser)
}

export function buildPolicy(currentUser: CurrentUser | null) {
  if (!currentUser) {
    return {
      canCreateDataSource: () => false,
      canCreateDashboard: () => false,
      canCreateQuery: () => false,
      canCreateAlert: () => false,
      canCreateUser: () => false,
      canViewQuery: () => false,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      canEditQuery: (_obj?: { user?: { id: number } }) => false,
      canRun: () => false,
      canListUsers: () => false,
      canListDataSources: () => false,
      canViewAdminStatus: () => false,
      canPublishReport: () => false,
      canPublishDashboard: () => false,
      canPublishVisualization: () => false,
      // False here despite being deny-listed below, and that is not a
      // contradiction: a signed-out visitor has no result grid to export from.
      // The only anonymous surfaces are the public report, dashboard and embed
      // pages, and none of them should offer a download.
      canExportData: () => false,
      isAdmin: false,
    }
  }

  return {
    // Data Sources: admin only
    canCreateDataSource: () => currentUser.isAdmin,

    // Dashboards: requires create_dashboard permission
    canCreateDashboard: () => currentUser.hasPermission('create_dashboard'),

    // Queries: requires create_query permission
    canCreateQuery: () => currentUser.hasPermission('create_query'),

    // Alerts: any authenticated user (Redash default)
    canCreateAlert: () => true,

    // Users: admin only
    canCreateUser: () => currentUser.isAdmin,

    // Viewing queries: requires view_query permission
    canViewQuery: () => currentUser.hasPermission('view_query'),

    // Editing: admin or owner (mirrors currentUser.canEdit)
    canEditQuery: (obj?: { user?: { id: number } }) => {
      if (!obj) return currentUser.hasPermission('edit_query')
      return currentUser.canEdit(obj)
    },

    // Running queries: always allowed for authenticated users
    canRun: () => true,

    // List users: requires list_users or admin
    canListUsers: () =>
      currentUser.hasPermission('list_users') || currentUser.isAdmin,

    // List data sources
    canListDataSources: () => currentUser.hasPermission('list_data_sources'),

    // Admin status page: requires super_admin
    canViewAdminStatus: () => currentUser.hasPermission('super_admin'),

    // Reports publishing: requires publish_report, or admin.
    //
    // Admin is not a shortcut here, it is the server's rule: veodyn-api reads
    // `is_admin or publish_report in permissions` (routers/report_guards.py).
    // Redash's built-in admin group carries a fixed permission list that will
    // never contain publish_report, because that permission belongs to this
    // product rather than to Redash, so checking the permission alone told
    // every admin they lacked a permission the server never asked them for and
    // hid the review controls they were entitled to.
    canPublishReport: () => currentUser.isAdmin || currentUser.hasPermission('publish_report'),

    // Minting or revoking a dashboard share link, and an embed share token.
    // Same shape as canPublishReport and for the same reason: the Redash fork
    // checks `is_admin or <perm> in permissions`, and Redash's built-in admin
    // group carries a fixed list that will never contain a permission this
    // product invented, so dropping the admin arm locks every admin out of a
    // control they own.
    canPublishDashboard: () =>
      currentUser.isAdmin || currentUser.hasPermission('publish_dashboard'),
    canPublishVisualization: () =>
      currentUser.isAdmin || currentUser.hasPermission('publish_visualization'),

    // Deny-listed, not allow-listed, and deliberately the opposite of the two
    // above. Group permissions are a free-form string array, and no group in
    // any existing instance carries a string invented today. So an allow-listed
    // `export_data` would evaluate false for every user the moment this build
    // ships and silently take Download away from the whole org. A deny flag
    // keeps today's behavior as the default and makes "this group may not
    // export" a thing someone had to do on purpose.
    //
    // What this gates is the visibility of the Download control and nothing
    // else. It is a policy signal, not a boundary: the rows are already in the
    // browser by the time the control would be drawn, and Redash's own
    // results.csv answers to anyone holding view_query. Do not read this as
    // enforcement, and do not describe it as enforcement elsewhere.
    canExportData: () => !currentUser.hasPermission('no_export_data'),

    isAdmin: currentUser.isAdmin,
  }
}
