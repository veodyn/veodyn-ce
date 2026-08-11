import { describe, expect, it } from 'vitest'
import { buildPolicy } from '@/lib/policy'
import type { CurrentUser, Permission } from '@/stores/auth-store'

describe('buildPolicy', () => {
  it('builds permission and ownership checks for an authenticated user', () => {
    const permissions: Permission[] = [
      'create_dashboard',
      'create_query',
      'edit_query',
      'view_query',
      'list_users',
      'list_data_sources',
      'super_admin',
      'publish_report',
    ]
    const currentUser: CurrentUser = {
      id: 7,
      name: 'Query Owner',
      email: 'owner@example.com',
      profile_image_url: '',
      groups: [2],
      api_key: 'test-key',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      is_disabled: false,
      is_invitation_pending: false,
      active_at: '2026-01-03T00:00:00Z',
      is_email_verified: true,
      auth_type: 'password',
      permissions,
      isAdmin: false,
      hasPermission: (permission) => permissions.includes(permission),
      canEdit: (object) => (object.user_id ?? object.user?.id) === 7,
      canCreate: () => true,
    }

    const policy = buildPolicy(currentUser)

    expect(policy.canCreateDataSource()).toBe(false)
    expect(policy.canCreateDashboard()).toBe(true)
    expect(policy.canCreateQuery()).toBe(true)
    expect(policy.canCreateAlert()).toBe(true)
    expect(policy.canCreateUser()).toBe(false)
    expect(policy.canViewQuery()).toBe(true)
    expect(policy.canEditQuery()).toBe(true)
    expect(policy.canEditQuery({ user: { id: 7 } })).toBe(true)
    expect(policy.canEditQuery({ user: { id: 8 } })).toBe(false)
    expect(policy.canRun()).toBe(true)
    expect(policy.canListUsers()).toBe(true)
    expect(policy.canListDataSources()).toBe(true)
    expect(policy.canViewAdminStatus()).toBe(true)
    expect(policy.canPublishReport()).toBe(true)
    expect(policy.isAdmin).toBe(false)
  })

  it('denies every capability when there is no current user', () => {
    const policy = buildPolicy(null)

    expect(policy.canCreateDataSource()).toBe(false)
    expect(policy.canCreateDashboard()).toBe(false)
    expect(policy.canCreateQuery()).toBe(false)
    expect(policy.canCreateAlert()).toBe(false)
    expect(policy.canCreateUser()).toBe(false)
    expect(policy.canViewQuery()).toBe(false)
    expect(policy.canEditQuery()).toBe(false)
    expect(policy.canEditQuery({ user: { id: 7 } })).toBe(false)
    expect(policy.canRun()).toBe(false)
    expect(policy.canListUsers()).toBe(false)
    expect(policy.canListDataSources()).toBe(false)
    expect(policy.canViewAdminStatus()).toBe(false)
    expect(policy.canPublishReport()).toBe(false)
    expect(policy.isAdmin).toBe(false)
  })

  it('denies report publishing without the permission', () => {
    const permissions: Permission[] = ['view_query']
    const currentUser: CurrentUser = {
      id: 8,
      name: 'Report Viewer',
      email: 'viewer@example.com',
      profile_image_url: '',
      groups: [3],
      api_key: 'test-key',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      is_disabled: false,
      is_invitation_pending: false,
      active_at: '2026-01-03T00:00:00Z',
      is_email_verified: true,
      auth_type: 'password',
      permissions,
      isAdmin: false,
      hasPermission: (permission) => permissions.includes(permission),
      canEdit: () => false,
      canCreate: () => false,
    }

    expect(buildPolicy(currentUser).canPublishReport()).toBe(false)
  })

  it('lets an admin publish reports without publish_report on the group', () => {
    // Redash's built-in admin group carries a fixed permission list, and
    // publish_report is not on it because it is this product's permission, not
    // Redash's. The server reads the same rule as `is_admin or publish_report`
    // (veodyn-api report_guards.actor), so an admin who could publish through
    // the API was shown a Publishing panel with every control disabled and a
    // note saying they needed a permission the server did not ask them for.
    const permissions: Permission[] = ['admin', 'super_admin', 'list_users']
    const currentUser: CurrentUser = {
      id: 1,
      name: 'Dana Admin',
      email: 'dana@example.com',
      profile_image_url: '',
      groups: [1],
      api_key: 'test-key',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      is_disabled: false,
      is_invitation_pending: false,
      active_at: '2026-01-03T00:00:00Z',
      is_email_verified: true,
      auth_type: 'password',
      permissions,
      isAdmin: true,
      hasPermission: (permission) => permissions.includes(permission),
      canEdit: () => true,
      canCreate: () => true,
    }

    expect(currentUser.hasPermission('publish_report')).toBe(false)
    expect(buildPolicy(currentUser).canPublishReport()).toBe(true)
  })
})

function userWith(permissions: Permission[], isAdmin = false): CurrentUser {
  return {
    id: 42,
    name: 'Sample User',
    email: 'sample@example.com',
    profile_image_url: '',
    groups: [2],
    api_key: 'test-key',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-01-03T00:00:00Z',
    is_email_verified: true,
    auth_type: 'password',
    permissions,
    isAdmin,
    hasPermission: (permission) => permissions.includes(permission),
    canEdit: () => isAdmin,
    canCreate: () => true,
  }
}

describe('external publishing permissions', () => {
  it('allow-lists the two publish checks', () => {
    expect(buildPolicy(userWith([])).canPublishDashboard()).toBe(false)
    expect(buildPolicy(userWith([])).canPublishVisualization()).toBe(false)
    expect(buildPolicy(userWith(['publish_dashboard'])).canPublishDashboard()).toBe(true)
    expect(buildPolicy(userWith(['publish_dashboard'])).canPublishVisualization()).toBe(false)
    expect(
      buildPolicy(userWith(['publish_visualization'])).canPublishVisualization()
    ).toBe(true)
  })

  it('lets an admin publish either surface without the permission on the group', () => {
    const admin = userWith(['admin', 'super_admin'], true)

    expect(admin.hasPermission('publish_dashboard')).toBe(false)
    expect(admin.hasPermission('publish_visualization')).toBe(false)
    expect(buildPolicy(admin).canPublishDashboard()).toBe(true)
    expect(buildPolicy(admin).canPublishVisualization()).toBe(true)
  })

  // The regression this design exists to prevent. Every group in every existing
  // instance carries zero of the strings invented by this change, so an
  // allow-listed export check would evaluate false for all of them on ship and
  // remove Download from the entire org without anyone asking for it.
  it('keeps export for a user carrying no permissions at all', () => {
    expect(buildPolicy(userWith([])).canExportData()).toBe(true)
  })

  it('keeps export for an ordinary user with unrelated permissions', () => {
    const analyst = userWith(['view_query', 'create_query', 'execute_query'])

    expect(buildPolicy(analyst).canExportData()).toBe(true)
  })

  it('denies export only for a group carrying no_export_data', () => {
    const restricted = userWith(['view_query', 'no_export_data'])

    expect(buildPolicy(restricted).canExportData()).toBe(false)
  })

  // Being an admin is an override for publishing, never for the deny flag: an
  // admin put in a no-export group is telling the product something on purpose.
  it('does not let admin override the export deny flag', () => {
    const restrictedAdmin = userWith(['admin', 'no_export_data'], true)

    expect(buildPolicy(restrictedAdmin).canExportData()).toBe(false)
  })

  it('denies all three to a signed-out visitor', () => {
    const policy = buildPolicy(null)

    expect(policy.canPublishDashboard()).toBe(false)
    expect(policy.canPublishVisualization()).toBe(false)
    expect(policy.canExportData()).toBe(false)
  })
})
