'use client'

import { useId, useState, useEffect, useCallback, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { redashApi } from '@/services/api-client'
import { FieldError, useFieldErrors } from '@/components/forms/field-errors'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useToast } from '@/components/shared/toast-provider'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { IconButton } from '@/components/shared/icon-button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface RedashGroup {
  id: number
  name: string
  type: 'builtin' | 'regular'
  permissions: string[]
  created_at: string
}

interface GroupListProps {
  onSelectGroup?: (group: RedashGroup) => void
}

export function GroupList({ onSelectGroup }: GroupListProps) {
  const toast = useToast()
  const currentUser = useAuthStore((s) => s.currentUser)
  const nameId = useId()
  const [groups, setGroups] = useState<RedashGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<RedashGroup | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const fieldErrors = useFieldErrors()

  const isAdmin = currentUser?.isAdmin ?? false

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await redashApi.get<RedashGroup[]>('groups')
      setGroups(result)
    } catch {
      toast.error('Failed to load groups')
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const closeCreate = () => {
    setShowCreate(false)
    fieldErrors.reset()
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!newName.trim()) {
      fieldErrors.fail({ [nameId]: 'Give the group a name.' })
      return
    }
    setIsCreating(true)
    try {
      const newGroup = await redashApi.post<RedashGroup>('groups', { name: newName })
      toast.success(`Group "${newName}" created`)
      setNewName('')
      closeCreate()
      load()
      if (onSelectGroup) onSelectGroup(newGroup)
    } catch {
      toast.error('Failed to create group')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async (group: RedashGroup) => {
    setIsDeleting(true)
    try {
      await redashApi.delete(`groups/${group.id}`)
      toast.success(`Group "${group.name}" deleted`)
      load()
    } catch {
      toast.error('Failed to delete group')
    } finally {
      setIsDeleting(false)
      setDeleteOpen(false)
    }
  }

  const columns: Column<RedashGroup>[] = [
    {
      key: 'name',
      title: 'Name',
      render: (g) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{g.name}</span>
          {g.type === 'builtin' && (
            <span className="text-[10px] uppercase text-muted-foreground border rounded px-1">
              built-in
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      title: '',
      render: (g) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onSelectGroup?.(g)
            }}
          >
            Members
          </Button>
          {isAdmin && g.type !== 'builtin' && (
            <IconButton
              tooltip="Delete group"
              aria-label={`Delete ${g.name}`}
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setPendingDelete(g)
                setDeleteOpen(true)
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </IconButton>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        {isAdmin && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        )}
      </div>

      <div className="bg-card rounded-lg border">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading…</div>
        ) : (
          <ItemsTable
            columns={columns}
            items={groups}
            rowKey={(g) => g.id}
            onRowClick={onSelectGroup}
            emptyMessage="No groups found"
          />
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={(next) => { if (!next) closeCreate() }}>
        <DialogContent size="md">
          <form noValidate onSubmit={handleCreate} className="contents">
            <DialogHeader>
              <DialogTitle>Create Group</DialogTitle>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto py-2">
              <Label htmlFor={nameId} className="mb-1 block" required>
                Group Name
              </Label>
              <Input
                id={nameId}
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  fieldErrors.clear(nameId)
                }}
                placeholder="e.g. Data Team"
                required
                aria-required="true"
                {...fieldErrors.fieldProps(nameId)}
              />
              <FieldError fieldId={nameId} message={fieldErrors.errors[nameId]} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCreate}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteOpen(false)
        }}
        title={`Delete group "${pendingDelete?.name ?? ''}"?`}
        description="This cannot be undone."
        isPending={isDeleting}
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete)
        }}
      />
    </div>
  )
}
