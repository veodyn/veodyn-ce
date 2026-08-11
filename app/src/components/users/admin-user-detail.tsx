'use client'

import { useId, useState, useEffect, useCallback } from 'react'
import { Save, Loader2, Ban, CheckCircle, AlertTriangle } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { redashApi } from '@/services/api-client'
import { toLocalLink } from '@/lib/link-utils'
import { useToast } from '@/components/shared/toast-provider'
import { BigMessage } from '@/components/shared/big-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/layout/page-header'
import { AdminUserDetailProfile } from './admin-user-detail-profile'
import { AdminUserDetailSecurity } from './admin-user-detail-security'
import { AdminUserDetailGroups } from './admin-user-detail-groups'
import type { RedashUserDetail, RedashGroup } from './user-detail-types'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

export type { RedashUserDetail } from './user-detail-types'

// ---------------------------------------------------------------------------
// Component
//
// Every panel here is a Card on its default padding. These used to pin a 20px
// override, the one step off the 8px scale in the app.
// ---------------------------------------------------------------------------

interface AdminUserDetailProps {
  userId: string
}

export function AdminUserDetail({ userId }: AdminUserDetailProps) {
  const toast = useToast()
  const currentUser = useAuthStore((s) => s.currentUser)
  const nameId = useId()
  const emailId = useId()
  const [user, setUser] = useState<RedashUserDetail | null>(null)
  const [allGroups, setAllGroups] = useState<RedashGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Editable fields
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [userGroupIds, setUserGroupIds] = useState<number[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Invite/reset link (shown when mail not configured or on demand)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const isOwnProfile = Number(userId) === currentUser?.id
  const isAdmin = currentUser?.isAdmin ?? false
  const canEdit = isAdmin || isOwnProfile

  // Track dirty state
  useEffect(() => {
    if (!user) return
    const nameChanged = name !== user.name
    const emailChanged = email !== user.email
    const groupsChanged =
      JSON.stringify([...userGroupIds].sort()) !== JSON.stringify([...user.groups].sort())
    setIsDirty(nameChanged || emailChanged || groupsChanged)
  }, [name, email, userGroupIds, user])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [userData, groupsData] = await Promise.all([
        redashApi.get<RedashUserDetail>(`users/${userId}`),
        redashApi.get<RedashGroup[]>('groups'),
      ])
      setLoadError(false)
      setUser(userData)
      setName(userData.name)
      setEmail(userData.email)
      setUserGroupIds(userData.groups)
      setAllGroups(groupsData)

      // Auto-fetch the invite link without sending email
      if (userData.is_invitation_pending) {
        const linkResult = await redashApi.get<{ invite_link: string }>(
          `users/${userId}/invite`
        )
        setInviteLink(toLocalLink(linkResult.invite_link))
      }
    } catch {
      // The toast is transient and the page text is permanent, so leaving the
      // page on "User not found." meant the two disagreed and the wrong one
      // survived: an administrator whose request was refused or timed out was
      // told the person does not exist.
      setLoadError(true)
      toast.error('Failed to load user')
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  // The bar stays on screen while the request is in flight, so without the
  // guard and the disabled button a second click sends the same edit twice.
  const handleSave = async () => {
    if (!user || isSaving) return
    setIsSaving(true)
    try {
      const payload: Record<string, unknown> = { name, email }
      if (isAdmin && !isOwnProfile) {
        payload.group_ids = userGroupIds
      }
      await redashApi.post(`users/${userId}`, payload)
      toast.success('User updated')
      load()
    } catch {
      toast.error('Failed to update user')
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleDisable = async () => {
    if (!user) return
    try {
      if (user.is_disabled) {
        await redashApi.delete(`users/${userId}/disable`)
        toast.success('User enabled')
      } else {
        await redashApi.post(`users/${userId}/disable`)
        toast.success('User disabled')
      }
      load()
    } catch {
      toast.error('Failed to update user status')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // A failed read is not a missing person. Same wording as the data source and
  // destination detail pages, which got this right first.
  if (loadError) {
    return (
      <BigMessage message="Unable to load this user. They may have been deleted, or the request was refused." />
    )
  }

  if (!user) {
    return <BigMessage message="User not found." />
  }

  const groupMap = new Map(allGroups.map((g) => [g.id, g]))
  const isDisabled = user.is_disabled
  const availableGroups = allGroups.filter((g) => !userGroupIds.includes(g.id))

  return (
    // Width belongs to the page shell (PageContainer width="narrow"), not to
    // this component: a max-w-3xl hidden in here is exactly the kind of
    // per-screen geometry the shell exists to own.
    <div className="space-y-5">
      {/* The page's one h1, at the same place every other detail route puts it.
          This name used to live inside the profile card below, which left
          /users/[userId] with no page title and its first heading at top 44 /
          L 364 instead of top 24 / L 264. */}
      <PageHeader title={user.name} description={user.email} />

      <AdminUserDetailProfile user={user} />

      {/* ── Account Details Card ── */}
      <Card>
        <CardHeader>
          <h3 className={SUBSECTION_HEADING}>Account Details</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor={nameId} className="text-xs text-muted-foreground block mb-1">
                Name
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit || isDisabled}
              />
            </div>
            <div>
              <Label htmlFor={emailId} className="text-xs text-muted-foreground block mb-1">
                Email
              </Label>
              <Input
                id={emailId}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!canEdit || isDisabled}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Groups Card ── */}
      <AdminUserDetailGroups
        userGroupIds={userGroupIds}
        groupMap={groupMap}
        availableGroups={availableGroups}
        isAdmin={isAdmin}
        isOwnProfile={isOwnProfile}
        onAddGroup={(id) =>
          setUserGroupIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
        }
        onRemoveGroup={(id) => setUserGroupIds((prev) => prev.filter((gid) => gid !== id))}
      />

      {/* ── Security Card ── */}
      {!isDisabled && (
        <AdminUserDetailSecurity
          userId={userId}
          user={user}
          isOwnProfile={isOwnProfile}
          isAdmin={isAdmin}
          canEdit={canEdit}
          inviteLink={inviteLink}
          onInviteLinkChange={setInviteLink}
          onUserChange={setUser}
        />
      )}

      {/* ── Danger Zone ── */}
      {isAdmin && !isOwnProfile && (
        <Card className="gap-3 bg-destructive/5 ring-destructive/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h3 className={`${SUBSECTION_HEADING} text-destructive`}>Danger Zone</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              {isDisabled
                ? 'This user is currently disabled. Re-enable to restore access.'
                : 'Disabling this user will revoke their access immediately.'}
            </p>
            <Button variant={isDisabled ? 'default' : 'destructive'} size="sm" onClick={handleToggleDisable}>
              {isDisabled ? (
                <>
                  <CheckCircle className="h-3.5 w-3.5" />
                  Enable User
                </>
              ) : (
                <>
                  <Ban className="h-3.5 w-3.5" />
                  Disable User
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Sticky Save Bar ── */}
      {canEdit && !isDisabled && isDirty && (
        <Card className="sticky bottom-4 flex-row items-center justify-between px-4 py-3 shadow-lg ring-primary/30">
          <p className="text-sm text-muted-foreground">You have unsaved changes</p>
          <Button onClick={handleSave} size="sm" disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {isSaving ? 'Saving…' : 'Save Changes'}
          </Button>
        </Card>
      )}
    </div>
  )
}
