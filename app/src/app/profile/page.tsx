'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { useProfile, useProfileGroups } from '@/hooks/use-profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { BigMessage } from '@/components/shared/big-message'
import { ApiKeyPanel } from '@/components/users/api-key-panel'
import { ChangePasswordDialog } from '@/components/users/change-password-dialog'
import { AdminUserDetailGroups } from '@/components/users/admin-user-detail-groups'
import type { RedashUserDetail } from '@/components/users/user-detail-types'
import { ProfileIdentity } from '@/components/profile/profile-identity'
import { ProfileAccount } from '@/components/profile/profile-account'
import { ProfileContent } from '@/components/profile/profile-content'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

// ---------------------------------------------------------------------------
// Your own profile. Deliberately not the admin user-detail view: this page
// answers "what is my account and where is my API key", which is what the MCP
// page sends people here for. Admin inspection of somebody else stays at
// /users/[userId].
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const currentUser = useAuthStore((s) => s.currentUser)
  const authLoading = useAuthStore((s) => s.isLoading)
  const queryClient = useQueryClient()
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)

  const userId = currentUser?.id
  const profileKey = ['profile', userId]

  const profile = useProfile()
  const groups = useProfileGroups()

  // The store starts with isLoading true and currentUser null, so "no user"
  // and "not resolved yet" are the same shape. Only the second one may render
  // a signed-out message, or a signed-in user sees it flash on first paint.
  if (authLoading || (userId !== undefined && profile.isPending)) {
    return (
      <PageContainer width="narrow" className="space-y-4">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </PageContainer>
    )
  }

  if (!currentUser || userId === undefined) {
    return (
      <PageContainer width="narrow">
        <BigMessage message="You are not signed in, so there is no profile to show." />
      </PageContainer>
    )
  }

  if (profile.isError || !profile.data) {
    return (
      <PageContainer width="narrow">
        <BigMessage message="Could not load your profile. Reload the page; if it keeps failing, your session may have expired." />
      </PageContainer>
    )
  }

  const user = profile.data
  const allGroups = groups.data ?? []

  const applyUser = (next: RedashUserDetail) => {
    queryClient.setQueryData(profileKey, next)
    // This is always your own account, so the signed-in identity has to follow
    // it. Without this the page reports success while useAuthStore still holds
    // the old name and email: signing out then rejects the new address and
    // accepts the one that is no longer yours, and anything created afterwards
    // is stamped with the stale name.
    useAuthStore.setState((state) =>
      state.currentUser && state.currentUser.id === next.id
        ? { currentUser: { ...state.currentUser, name: next.name, email: next.email } }
        : {}
    )
  }

  return (
    // narrow, matching /users/[userId], this route's structural twin: a form,
    // an API key read-out and two-column owned-item tables. At `full` the 448px
    // fields floated in an 1885px column and the tables stretched to match.
    <PageContainer width="narrow" className="space-y-4">
      {/* Profile had no page title at all: the first heading was the user's own
          name inside the identity card, 100px right of and 20px below where
          every other route puts its title. The card stays, since it carries the
          avatar and join date, but the page announces itself first. */}
      <PageHeader title="Profile" description="Your account, API key, and group membership." />

      <ProfileIdentity user={user} />

      <ProfileAccount user={user} onSaved={applyUser} />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h3 className={SUBSECTION_HEADING}>Security</h3>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Always regenerable: it is your own key, so there is no permission
              question, only the confirm the panel already raises. */}
          <ApiKeyPanel
            userId={String(user.id)}
            apiKey={user.api_key}
            canRegenerate
            onRegenerated={applyUser}
          />
          <div className="pt-3 border-t">
            <Button variant="outline" size="sm" onClick={() => setShowPasswordDialog(true)}>
              <Lock className="h-3.5 w-3.5" />
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Directly under Security, not at the foot of the page: group membership
          is what your account may reach, so it belongs with the key and the
          password rather than below a list of everything you have made.

          Read-only by construction: AdminUserDetailGroups derives
          canManage = isAdmin && !isOwnProfile, so these two props force it
          false regardless of whether the viewer happens to be an admin. Nobody
          edits their own group membership from their own profile. */}
      <AdminUserDetailGroups
        userGroupIds={user.groups}
        groupMap={new Map(allGroups.map((group) => [group.id, group]))}
        availableGroups={allGroups}
        isAdmin={false}
        isOwnProfile
        onAddGroup={() => {}}
        onRemoveGroup={() => {}}
      />

      <ProfileContent userId={user.id} />

      <ChangePasswordDialog
        userId={String(user.id)}
        open={showPasswordDialog}
        onClose={() => setShowPasswordDialog(false)}
      />
    </PageContainer>
  )
}
