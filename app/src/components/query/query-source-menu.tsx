'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  MoreHorizontal, GitFork, Archive, Users, PenLine, Clock, Key,
  LayoutDashboard, Shield,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useConfig } from '@/components/config/config-provider'
import { useForkQuery, useArchiveQuery, useUpdateQuery } from '@/hooks/use-queries'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useToast } from '@/components/shared/toast-provider'
import { removalCopy } from '@/lib/removal'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MockQuery } from '@/lib/mock-data'

interface QuerySourceMenuProps {
  query: MockQuery
  onOpenSchedule: () => void
  onOpenApiKey: () => void
  onOpenAddToDashboard: () => void
  onOpenPermissions: () => void
}

export function QuerySourceMenu({
  query,
  onOpenSchedule,
  onOpenApiKey,
  onOpenAddToDashboard,
  onOpenPermissions,
}: QuerySourceMenuProps) {
  const router = useRouter()
  const currentUser = useAuthStore((s) => s.currentUser)
  const draftsEnabled = useConfig().features.query_drafts
  const forkQuery = useForkQuery()
  const archiveQuery = useArchiveQuery()
  const updateQuery = useUpdateQuery()
  const toast = useToast()
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  // can_edit is Redash's can_modify, and it is the right rule for Schedule,
  // API Key, Permissions and the draft toggle: those all go through
  // require_object_modify_permission.
  const canEdit = query.can_edit || currentUser?.isAdmin
  // Archiving does not. QueryResource.delete is guarded by
  // require_admin_or_owner(query.user_id) (redash/handlers/queries.py:431),
  // with no has_access arm, so an ACL editor who was granted MODIFY has
  // can_edit, sees Archive, and gets a 403 on it. Owner or admin only, which is
  // what currentUser.canEdit answers.
  const canArchive = currentUser?.canEdit(query) === true
  const isShared = !query.is_draft
  // Centralised so the row menu on /queries and this one cannot describe the
  // same act differently. The description is the part that matters here: see
  // confirmArchive below.
  const archiveCopy = removalCopy('query', query.name)

  const handleFork = async () => {
    const forked = await forkQuery.mutateAsync(query.id)
    // Redash forks into a draft: Query.fork builds a bare Query, and the
    // is_draft column defaults to true. With the draft workflow off there is no
    // control anywhere that would get the copy back out of that state, so it
    // would sit in its author's list and nobody else's for good. Same second
    // request the create path needs, for the same reason.
    if (!draftsEnabled) await updateQuery.mutateAsync({ id: forked.id, is_draft: false })
    router.push(`/queries/${forked.id}/source`)
  }

  // Archiving a query is not the tidy-up the label suggests. Query.archive
  // (node/redash/models/__init__.py:491-505) clears the schedule, deletes
  // every alert on the query and deletes every widget built on every one of its
  // visualizations; unarchiving brings none of that back. This fired on one
  // unconfirmed click and said none of it, so the dialog is the change.
  const confirmArchive = () => {
    archiveQuery.mutate(query.id, {
      onSuccess: () => {
        setConfirmingArchive(false)
        toast.success(`Archived "${query.name}".`)
        router.push('/queries')
      },
      onError: () => {
        setConfirmingArchive(false)
        toast.error(`Could not archive "${query.name}". You must own it, or be an admin.`)
      },
    })
  }

  const handleToggleDraft = () => {
    updateQuery.mutate({ id: query.id, is_draft: isShared })
  }

  // Names the audience, because that is the only thing the action changes: the
  // query joins or leaves the list the rest of the org browses. It grants and
  // revokes nothing, since the read path gates on data source access alone.
  // Absent entirely unless the draft workflow is on: with the flag off saving
  // already shares the query, so this would be the one control that could take
  // it back out of the shared list, and "draft" is a word the product never
  // otherwise uses.
  const shareItem = isShared
    ? { label: 'Make it a draft', icon: PenLine }
    : { label: 'Share with the team', icon: Users }

  // Publishing a visualization is deliberately NOT here. It is a per-tab act
  // (the ScreenShare button on the active visualization tab), because a menu
  // this far from the tabs can only publish "the query", and the one time it
  // did, it published visualizations[0] whatever tab was on screen.
  const menuItems = [
    { label: 'Fork', icon: GitFork, onClick: handleFork, show: true },
    { ...shareItem, onClick: handleToggleDraft, show: canEdit && draftsEnabled },
    { label: 'Schedule', icon: Clock, onClick: onOpenSchedule, show: canEdit },
    { label: 'API Key', icon: Key, onClick: onOpenApiKey, show: canEdit },
    { label: 'Add to Dashboard', icon: LayoutDashboard, onClick: onOpenAddToDashboard, show: true },
    { label: 'Permissions', icon: Shield, onClick: onOpenPermissions, show: canEdit },
    {
      label: 'Archive',
      icon: Archive,
      onClick: () => setConfirmingArchive(true),
      show: canArchive,
      destructive: true,
    },
  ]

  return (
    <>
      <DropdownMenu>
        {/* A lone kebab beside Run and Save says nothing about what it holds
            (Share, Schedule, Permissions, Archive), and it is the only way to
            reach any of them. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                aria-label="Query actions"
                render={<Button variant="outline" size="icon-lg" />}
              />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>Query actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {menuItems.filter((item) => item.show).map((item) => (
            <DropdownMenuItem
              key={item.label}
              onClick={item.onClick}
              variant={item.destructive ? 'destructive' : 'default'}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmingArchive && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmingArchive(false)
          }}
          title={archiveCopy.title}
          description={archiveCopy.description}
          confirmLabel={archiveCopy.verb}
          isPending={archiveQuery.isPending}
          onConfirm={confirmArchive}
        />
      )}
    </>
  )
}
