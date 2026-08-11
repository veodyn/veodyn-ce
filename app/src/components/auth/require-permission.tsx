'use client'

import { useAuthStore, type Permission } from '@/stores/auth-store'

interface RequirePermissionProps {
  permission: Permission | Permission[]
  /** If true, requires ALL listed permissions (AND). Otherwise requires ANY (OR). */
  requireAll?: boolean
  children: React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Mirrors Redash's @require_permission / @require_any_of_permission pattern.
 * Conditionally renders children based on current user's permissions.
 */
export function RequirePermission({
  permission,
  requireAll = false,
  children,
  fallback,
}: RequirePermissionProps) {
  const currentUser = useAuthStore((s) => s.currentUser)

  if (!currentUser) {
    return fallback ? <>{fallback}</> : null
  }

  const perms = Array.isArray(permission) ? permission : [permission]
  const hasAccess = requireAll
    ? perms.every((p) => currentUser.hasPermission(p))
    : perms.some((p) => currentUser.hasPermission(p))

  if (!hasAccess) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <div className="p-6 text-center text-muted-foreground">
        You don&apos;t have permission to access this page.
      </div>
    )
  }

  return <>{children}</>
}

/**
 * Shorthand: only renders for admin users.
 * Mirrors Redash's @require_admin decorator.
 */
export function RequireAdmin({
  children,
  fallback,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  return (
    <RequirePermission permission="admin" fallback={fallback}>
      {children}
    </RequirePermission>
  )
}
