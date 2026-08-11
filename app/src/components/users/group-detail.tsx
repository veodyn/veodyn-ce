'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Trash2, Loader2 } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { ApiError, redashApi } from '@/services/api-client'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GroupMembers } from './group-members'
import { GroupDataSources } from './group-data-sources'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RedashGroupDetail {
  id: number
  name: string
  type: 'builtin' | 'regular'
  permissions: string[]
}

interface RedashGroupMember {
  id: number
  name: string
  email: string
  profile_image_url: string | null
}

interface RedashGroupDataSource {
  id: number
  name: string
  type: string
  view_only: boolean
}

/** Why there is no group to show: it is absent, or the load did not succeed. */
type LoadError = 'not_found' | 'failed'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GroupDetailProps {
  groupId: string
  onBack: () => void
}

export function GroupDetail({ groupId, onBack }: GroupDetailProps) {
  const toast = useToast()
  const currentUser = useAuthStore((s) => s.currentUser)
  const [group, setGroup] = useState<RedashGroupDetail | null>(null)
  const [members, setMembers] = useState<RedashGroupMember[]>([])
  const [dataSources, setDataSources] = useState<RedashGroupDataSource[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const [name, setName] = useState('')
  const [tab, setTab] = useState<'members' | 'data_sources'>('members')

  // Add data source
  const [allDataSources, setAllDataSources] = useState<Array<{ id: number; name: string }>>([])

  const isAdmin = currentUser?.isAdmin ?? false
  const isBuiltin = group?.type === 'builtin'
  // What a rename would actually send. The Save control keys off the same
  // value, so it is never offered for a name the save would refuse.
  const trimmedName = name.trim()

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const [groupData, membersData, dsData] = await Promise.all([
        redashApi.get<RedashGroupDetail>(`groups/${groupId}`),
        redashApi.get<RedashGroupMember[]>(`groups/${groupId}/members`),
        redashApi.get<RedashGroupDataSource[]>(`groups/${groupId}/data_sources`),
      ])
      setGroup(groupData)
      setName(groupData.name)
      setMembers(membersData)
      setDataSources(dsData)
    } catch (err) {
      // Only a 404 means the group is not there. A network error, a 403 or a
      // 500 is a load that failed, and must not be shown as an empty page.
      const missing = err instanceof ApiError && err.status === 404
      setLoadError(missing ? 'not_found' : 'failed')
      if (!missing) toast.error('Failed to load group')
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  useEffect(() => {
    load()
  }, [load])

  // Load all data sources for adding
  useEffect(() => {
    if (tab === 'data_sources' && isAdmin) {
      redashApi
        .get<Array<{ id: number; name: string }>>('data_sources')
        .then(setAllDataSources)
        .catch(() => {})
    }
  }, [tab, isAdmin])

  const handleSaveName = async () => {
    if (!trimmedName) {
      toast.error('Group name cannot be empty')
      return
    }
    try {
      await redashApi.post(`groups/${groupId}`, { name: trimmedName })
      toast.success('Group name updated')
      setGroup((g) => (g ? { ...g, name: trimmedName } : g))
    } catch {
      toast.error('Failed to update group name')
    }
  }

  const handleAddMember = async (userId: number) => {
    try {
      await redashApi.post(`groups/${groupId}/members`, { user_id: userId })
      load()
    } catch (err) {
      toast.error('Failed to add member')
      throw err
    }
  }

  const handleRemoveMember = async (userId: number) => {
    try {
      await redashApi.delete(`groups/${groupId}/members/${userId}`)
      setMembers((prev) => prev.filter((m) => m.id !== userId))
    } catch {
      toast.error('Failed to remove member')
    }
  }

  const handleAddDataSource = async (dsId: string) => {
    if (!dsId) return
    try {
      await redashApi.post(`groups/${groupId}/data_sources`, {
        data_source_id: Number(dsId),
      })
      load()
    } catch {
      toast.error('Failed to add data source')
    }
  }

  const handleRemoveDataSource = async (dsId: number) => {
    try {
      await redashApi.delete(`groups/${groupId}/data_sources/${dsId}`)
      setDataSources((prev) => prev.filter((ds) => ds.id !== dsId))
    } catch {
      toast.error('Failed to remove data source')
    }
  }

  const handleUpdateDataSourcePermission = async (dsId: number, viewOnly: boolean) => {
    try {
      await redashApi.post(`groups/${groupId}/data_sources/${dsId}`, {
        view_only: viewOnly,
      })
      setDataSources((prev) =>
        prev.map((ds) => (ds.id === dsId ? { ...ds, view_only: viewOnly } : ds))
      )
    } catch {
      toast.error('Failed to update permissions')
    }
  }

  const handleDelete = async () => {
    if (!group) return
    // The server's current name, not the rename field: an unsaved edit must not
    // change what the last guard before an irreversible delete says is going.
    if (!confirm(`Delete group "${group.name}"? This cannot be undone.`)) return
    try {
      await redashApi.delete(`groups/${groupId}`)
      toast.success(`Group "${group.name}" deleted`)
      onBack()
    } catch {
      toast.error('Failed to delete group')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!group) {
    return (
      <p className="text-muted-foreground">
        {loadError === 'failed'
          ? 'Failed to load this group. It may be unavailable, or you may not have access to it.'
          : 'Group not found.'}
      </p>
    )
  }

  const dsIds = new Set(dataSources.map((ds) => ds.id))
  const availableDataSources = allDataSources.filter((ds) => !dsIds.has(ds.id))

  return (
    <div className="max-w-3xl space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Groups
      </Button>

      {/* Group Header Card */}
      <div className="bg-card rounded-lg border p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isAdmin && !isBuiltin ? (
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-base font-semibold max-w-sm h-8 border-transparent bg-transparent hover:border-border"
                />
              ) : (
                <h2 className="text-base font-semibold">{name}</h2>
              )}
              {isBuiltin && (
                <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">
                  built-in
                </span>
              )}
              {isAdmin && trimmedName !== '' && trimmedName !== group.name && (
                <Button size="sm" variant="outline" onClick={handleSaveName}>
                  Save
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {members.length} member{members.length !== 1 ? 's' : ''} &middot;{' '}
              {dataSources.length} data source{dataSources.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'members' | 'data_sources')}>
        <TabsList variant="line">
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
          <TabsTrigger value="data_sources">Data Sources ({dataSources.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <GroupMembers
            members={members}
            isAdmin={isAdmin}
            isBuiltin={isBuiltin}
            currentUserId={currentUser?.id}
            onAddMember={handleAddMember}
            onRemoveMember={handleRemoveMember}
          />
        </TabsContent>
        <TabsContent value="data_sources">
          <GroupDataSources
            dataSources={dataSources}
            availableDataSources={availableDataSources}
            isAdmin={isAdmin}
            onAddDataSource={handleAddDataSource}
            onRemoveDataSource={handleRemoveDataSource}
            onUpdatePermission={handleUpdateDataSourcePermission}
          />
        </TabsContent>
      </Tabs>

      {/* Delete group */}
      {isAdmin && !isBuiltin && (
        <div className="pt-4 border-t">
          <Button variant="destructive" onClick={handleDelete}>
          <Trash2 className="h-3.5 w-3.5" />
            Delete Group
          </Button>
        </div>
      )}
    </div>
  )
}
