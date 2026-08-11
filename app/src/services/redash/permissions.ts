/**
 * Object-level access grants against the real Redash backend.
 *
 * Redash exposes /api/<object_type>/<object_id>/acl (redash/handlers/permissions.py):
 * GET returns a map of access type to grantees, POST grants, DELETE revokes.
 * Both writes are gated server-side by require_admin_or_owner, so a
 * non-owner's attempt fails there rather than being prevented here.
 */

import { redashApi } from '@/services/api-client'
import type { RedashUserRef } from './types'

/**
 * Redash's ACCESS_TYPES (redash/permissions.py). Only `modify` is ever granted
 * from this UI, matching Redash's own permissions modal: `view` is implied by
 * being able to see the object at all, and `delete` is not something this
 * dialog offers.
 */
export type AccessType = 'view' | 'modify' | 'delete'

export const GRANTED_ACCESS_TYPE: AccessType = 'modify'

export type AclObjectType = 'queries' | 'dashboards'

/** The GET shape: present access types only, each with its grantees. */
export type AclResponse = Partial<Record<AccessType, RedashUserRef[]>>

export async function fetchAcl(
  objectType: AclObjectType,
  objectId: number,
  opts?: { signal?: AbortSignal }
): Promise<AclResponse> {
  return redashApi.get<AclResponse>(`${objectType}/${objectId}/acl`, { signal: opts?.signal })
}

export async function grantAccess(
  objectType: AclObjectType,
  objectId: number,
  userId: number,
  accessType: AccessType = GRANTED_ACCESS_TYPE
): Promise<void> {
  await redashApi.post(`${objectType}/${objectId}/acl`, {
    access_type: accessType,
    user_id: userId,
  })
}

export async function revokeAccess(
  objectType: AclObjectType,
  objectId: number,
  userId: number,
  accessType: AccessType = GRANTED_ACCESS_TYPE
): Promise<void> {
  // Redash reads the grantee from the request body on DELETE, not the path.
  await redashApi.delete(`${objectType}/${objectId}/acl`, {
    data: { access_type: accessType, user_id: userId },
  })
}
