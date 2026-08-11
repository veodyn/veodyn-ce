'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import {
  fetchAcl,
  grantAccess,
  revokeAccess,
  GRANTED_ACCESS_TYPE,
  type AccessType,
  type AclObjectType,
} from '@/services/redash/permissions'
import { useMockDataStore } from '@/stores/mock-data-store'

/**
 * One grantee and everything they have been granted.
 *
 * The grantee's name and email come from the ACL response itself rather than
 * from a separate user list. Intersecting ids against the paged /users request
 * would drop anyone past its page limit, or drop everyone if that request
 * failed: a real grant would vanish from the dialog and could not be revoked,
 * which is the same class of silent wrongness this dialog is being fixed for.
 */
export interface AccessGrant {
  user: { id: number; name: string; email: string }
  /** Every type held. Revoking has to name each one; see useRevokeAccess. */
  accessTypes: AccessType[]
}

/**
 * Who has been granted access to a query or dashboard, beyond its owner.
 *
 * This dialog previously had no data path at all: it was handed the author's
 * id as the entire permitted list and an `onUpdate` of `() => {}`, so adding a
 * user did nothing, silently.
 */
export function useObjectPermissions(objectType: AclObjectType, objectId: number, enabled = true) {
  const grantedIds = useMockDataStore((s) => s.accessGrants[objectType][objectId])
  const mockUsers = useMockDataStore((s) => s.users)

  return useQuery<AccessGrant[]>({
    queryKey: ['acl', objectType, objectId, grantedIds ?? []],
    queryFn: async ({ signal }) => {
      if (!USE_REAL_API) {
        return (grantedIds ?? []).flatMap((id) => {
          const user = mockUsers.find((u) => u.id === id)
          return user
            ? [{ user: { id, name: user.name, email: user.email }, accessTypes: [GRANTED_ACCESS_TYPE] }]
            : []
        })
      }

      const acl = await fetchAcl(objectType, objectId, { signal })
      const byUser = new Map<number, AccessGrant>()
      for (const [accessType, grantees] of Object.entries(acl)) {
        for (const grantee of grantees ?? []) {
          const existing = byUser.get(grantee.id)
          if (existing) {
            existing.accessTypes.push(accessType as AccessType)
          } else {
            byUser.set(grantee.id, {
              user: { id: grantee.id, name: grantee.name, email: grantee.email },
              accessTypes: [accessType as AccessType],
            })
          }
        }
      }
      return [...byUser.values()]
    },
    enabled: enabled && Number.isFinite(objectId),
  })
}

export function useGrantAccess(objectType: AclObjectType, objectId: number) {
  const qc = useQueryClient()
  const store = useMockDataStore()

  return useMutation({
    mutationFn: async (userId: number) => {
      if (!USE_REAL_API) {
        store.grantAccess(objectType, objectId, userId)
        return
      }
      await grantAccess(objectType, objectId, userId, GRANTED_ACCESS_TYPE)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acl', objectType, objectId] }),
  })
}

export function useRevokeAccess(objectType: AclObjectType, objectId: number) {
  const qc = useQueryClient()
  const store = useMockDataStore()

  return useMutation({
    // Every type the grantee holds, not just `modify`. Redash's revoke deletes
    // the one access type it is given and returns 200 either way
    // (redash/handlers/permissions.py, ObjectPermissionsListResource.delete),
    // so revoking only `modify` from someone granted `view` would report
    // success and leave them exactly where they were.
    mutationFn: async (grant: AccessGrant) => {
      if (!USE_REAL_API) {
        store.revokeAccess(objectType, objectId, grant.user.id)
        return
      }
      for (const accessType of grant.accessTypes) {
        await revokeAccess(objectType, objectId, grant.user.id, accessType)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acl', objectType, objectId] }),
  })
}
