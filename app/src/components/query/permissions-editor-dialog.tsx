'use client'

import { useId, useState } from 'react'
import { Search, X, Shield } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/shared/toast-provider'
import { useUsers } from '@/hooks/use-users'
import {
  useObjectPermissions,
  useGrantAccess,
  useRevokeAccess,
} from '@/hooks/use-object-permissions'
import type { AccessGrant } from '@/hooks/use-object-permissions'
import type { AclObjectType } from '@/services/redash/permissions'

interface PermissionsEditorDialogProps {
  open: boolean
  onClose: () => void
  objectType?: AclObjectType
  objectId: number
  authorId: number
}

export function PermissionsEditorDialog({
  open,
  onClose,
  objectType = 'queries',
  objectId,
  authorId,
}: PermissionsEditorDialogProps) {
  const [search, setSearch] = useState('')
  const toast = useToast()
  const { data: usersData } = useUsers()
  const allUsers = usersData?.results ?? []
  const searchId = useId()

  // Only fetched while the dialog is open: an ACL request on every query page
  // would be a request nobody asked for.
  const { data: grants, isLoading, isError } = useObjectPermissions(objectType, objectId, open)
  const grant = useGrantAccess(objectType, objectId)
  const revoke = useRevokeAccess(objectType, objectId)

  // Grantees are rendered from the ACL itself, so someone past the /users page
  // limit still appears and can still be revoked.
  const granted = (grants ?? []).filter((g) => g.user.id !== authorId)
  const grantedIds = granted.map((g) => g.user.id)
  const author = allUsers.find((u) => u.id === authorId)
  const needle = search.trim().toLowerCase()
  const available = allUsers.filter(
    (u) =>
      !grantedIds.includes(u.id) &&
      u.id !== authorId &&
      (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
  )

  // Both writes report their failure. Granting access is exactly where a silent
  // failure is worst: the dialog closes and someone believes a colleague can
  // reach the query when they cannot.
  const addUser = (userId: number, name: string) => {
    grant.mutate(userId, {
      onSuccess: () => {
        toast.success(`${name} can now edit this query`)
        setSearch('')
      },
      onError: () =>
        toast.error(`Could not give ${name} access. You must own this query, or be an admin.`),
    })
  }

  const removeUser = (accessGrant: AccessGrant) => {
    const { name } = accessGrant.user
    revoke.mutate(accessGrant, {
      onSuccess: () => toast.success(`${name} no longer has access`),
      onError: () => toast.error(`Could not remove ${name}'s access. Nothing has changed.`),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Manage Permissions</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div>
            {/* A heading over the whole list below, not a control of its own, so
                it becomes a div rather than a label with a fabricated htmlFor. */}
            <div className="text-sm font-medium block mb-1">Permitted Users</div>
            {/* Redash grants one level from here, `modify`, so saying it once
                beats a per-row badge that would read the same on every row. The
                list used to state no access level at all. */}
            <p className="mb-2 text-xs text-muted-foreground">
              Everyone listed can view and edit this query. The author always can, and cannot be
              removed.
            </p>
            <div className="border rounded-md divide-y max-h-[200px] overflow-y-auto">
              {isLoading ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading permissions…</div>
              ) : isError ? (
                // Not an empty list. "Nobody else has access" and "we could not
                // find out" are different answers, and only one is safe to act on.
                <div className="px-3 py-4 text-sm text-destructive">
                  Could not load who has access. Close and reopen to try again.
                </div>
              ) : (
                <>
                  {author && (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm">{author.name}</span>
                      <span className="text-xs text-muted-foreground">{author.email}</span>
                      <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        <Shield className="h-3 w-3" /> Author
                      </span>
                    </div>
                  )}
                  {granted.map((g) => (
                    <div key={g.user.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{g.user.name}</span>
                        <span className="text-xs text-muted-foreground">{g.user.email}</span>
                      </div>
                      <IconButton
                        tooltip="Revoke access"
                        aria-label={`Remove ${g.user.name}`}
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeUser(g)}
                        disabled={revoke.isPending}
                        className="hover:bg-destructive/10"
                      >
                        <X className="h-3.5 w-3.5 text-destructive" />
                      </IconButton>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor={searchId} className="mb-2 block">
              Add User
            </Label>
            <InputGroup className="mb-2">
              <InputGroupAddon>
                <Search className="h-4 w-4" />
              </InputGroupAddon>
              <InputGroupInput
                id={searchId}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users..."
              />
            </InputGroup>
            {search && (
              <div className="border rounded-md divide-y max-h-[200px] overflow-y-auto">
                {available.map((u) => (
                  <Button
                    key={u.id}
                    variant="ghost"
                    onClick={() => addUser(u.id, u.name)}
                    disabled={grant.isPending}
                    className="w-full h-auto justify-start gap-2 rounded-none px-3 py-2 hover:bg-muted/50"
                  >
                    <span className="text-sm">{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.email}</span>
                  </Button>
                ))}
                {available.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    No users found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
