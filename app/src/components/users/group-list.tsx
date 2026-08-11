'use client'

import { useId, useState, useEffect, useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { redashApi } from '@/services/api-client'
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

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const newGroup = await redashApi.post<RedashGroup>('groups', { name: newName })
      toast.success(`Group "${newName}" created`)
      setNewName('')
      setShowCreate(false)
      load()
      if (onSelectGroup) onSelectGroup(newGroup)
    } catch {
      toast.error('Failed to create group')
    }
  }

  const handleDelete = async (group: RedashGroup, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete group "${group.name}"? This cannot be undone.`)) return
    try {
      await redashApi.delete(`groups/${group.id}`)
      toast.success(`Group "${group.name}" deleted`)
      load()
    } catch {
      toast.error('Failed to delete group')
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
              onClick={(e) => handleDelete(g, e)}
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

      <Dialog open={showCreate} onOpenChange={(next) => { if (!next) setShowCreate(false) }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto py-2">
            <Label htmlFor={nameId} className="mb-1 block">
              Group Name
            </Label>
            <Input
              id={nameId}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Data Team"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
