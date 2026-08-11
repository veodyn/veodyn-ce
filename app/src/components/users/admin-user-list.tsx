'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, AlertCircle } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { redashApi } from '@/services/api-client'
import { useToast } from '@/components/shared/toast-provider'
import Link from 'next/link'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'
import { TimeAgo } from '@/components/shared/time-ago'
import { UserAvatar } from '@/components/shared/user-avatar'
import { Paginator } from '@/components/shared/paginator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InviteDialog } from './invite-dialog'
import { UserRowActions } from './user-row-actions'

// ---------------------------------------------------------------------------
// Redash user list response
// ---------------------------------------------------------------------------

interface RedashUserListResponse {
  count: number
  page: number
  page_size: number
  results: RedashUser[]
}

export interface RedashUser {
  id: number
  name: string
  email: string
  profile_image_url: string | null
  groups: Array<{ id: number; name: string }>
  created_at: string
  updated_at: string
  disabled_at: string | null
  is_disabled: boolean
  active_at: string | null
  is_invitation_pending: boolean
  is_email_verified: boolean
  auth_type: string
}

type UserFilter = 'active' | 'pending' | 'disabled'

const PAGE_SIZE = 25

export function AdminUserList() {
  const router = useRouter()
  const toast = useToast()
  const currentUser = useAuthStore((s) => s.currentUser)
  const [users, setUsers] = useState<RedashUser[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<UserFilter>('active')
  const [page, setPage] = useState(1)
  const [showInvite, setShowInvite] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const params: Record<string, string | number> = {
        page,
        page_size: PAGE_SIZE,
      }
      if (filter === 'pending') params.pending = 'true'
      else if (filter === 'disabled') params.disabled = 'true'
      if (search) params.q = search

      const json = await redashApi.get<RedashUserListResponse>('users', { params })
      setUsers(json.results)
      setTotalCount(json.count)
      setLoadError(null)
    } catch (error) {
      // Keep the failure on the panel too. Toasting alone leaves the table
      // showing a calm "No users found", which reads as "there are none".
      const message = error instanceof Error ? error.message : 'Failed to load users'
      setUsers([])
      setTotalCount(0)
      setLoadError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page, search])

  useEffect(() => {
    load()
  }, [load])

  const handleDisable = async (user: RedashUser) => {
    try {
      await redashApi.post(`users/${user.id}/disable`)
      toast.success(`${user.name} has been disabled`)
      load()
    } catch {
      toast.error('Failed to disable user')
    }
  }

  const handleEnable = async (user: RedashUser) => {
    try {
      await redashApi.delete(`users/${user.id}/disable`)
      toast.success(`${user.name} has been enabled`)
      load()
    } catch {
      toast.error('Failed to enable user')
    }
  }

  const handleDelete = async (user: RedashUser) => {
    if (!confirm(`Delete ${user.name}? This cannot be undone.`)) return
    try {
      await redashApi.delete(`users/${user.id}`)
      toast.success(`${user.name} has been deleted`)
      load()
    } catch {
      toast.error('Failed to delete user')
    }
  }

  const isAdmin = currentUser?.isAdmin ?? false
  const currentUserId = currentUser?.id

  const columns: Column<RedashUser>[] = [
    {
      key: 'name',
      title: 'Name',
      // The name is a real link, the way it is on /queries and /dashboards.
      // It used to be a plain span, and the row navigated from an onClick on
      // the <tr>. That left "Disable" as the ONLY focusable control in the row:
      // a keyboard user could reach the destructive action but could not open
      // the person's page at all, and nobody could middle-click it into a new
      // tab. onRowClick stays for the mouse-anywhere-on-the-row habit.
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar id={u.id} name={u.name} email={u.email} imageUrl={u.profile_image_url} />
          <div className="min-w-0">
            <Link
              href={`/users/${u.id}`}
              className={ENTITY_NAME_CLASS}
              onClick={(e) => e.stopPropagation()}
            >
              {u.name}
            </Link>
            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'groups',
      title: 'Groups',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.groups.map((g) => (
            <Badge key={g.id} variant={g.name === 'admin' ? 'default' : 'secondary'}>
              {g.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'created_at',
      title: 'Joined',
      render: (u) => <TimeAgo date={u.created_at} className="text-muted-foreground" />,
    },
    {
      key: 'active_at',
      title: 'Last Active',
      render: (u) =>
        u.active_at ? (
          <TimeAgo date={u.active_at} className="text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            title: '',
            render: (u: RedashUser) =>
              u.id === currentUserId ? null : (
                <UserRowActions
                  user={u}
                  onEnable={handleEnable}
                  onDisable={handleDisable}
                  onDelete={handleDelete}
                />
              ),
          } as Column<RedashUser>,
        ]
      : []),
  ]

  const filterTabs: { key: UserFilter; label: string }[] = [
    { key: 'active', label: 'Active Users' },
    { key: 'pending', label: 'Pending Invitations' },
    ...(isAdmin ? [{ key: 'disabled' as const, label: 'Disabled Users' }] : []),
  ]

  return (
    <div className="space-y-4">
      {/* Filter strip. The Tabs primitive drives `filter` directly, the same
          controlled value that decides which query params `load` sends, so an
          arrow-key or click move on a tab changes the request, not only the
          underline. There is no TabsContent: the table below is the single
          panel every tab shares, not a per-tab pane. */}
      <Tabs
        value={filter}
        onValueChange={(v) => {
          setFilter(v as UserFilter)
          setPage(1)
        }}
      >
        <TabsList variant="line" aria-label="Filter users" className="border-b">
          {filterTabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* The shared toolbar, not a local w-[300px]: that arbitrary width was the
          only one in the app that matched neither the shared w-64 nor anything
          else, and this list was showing no result count while every other one
          did. totalCount is the server-side total for the current filter, which
          is what the reader wants, not the size of the visible page. */}
      <div className="flex items-start justify-between gap-3">
        <ListToolbar
          search={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchLabel="Search users"
          placeholder="Search users..."
          // No count while the load is failing. 0 is a claim about the data,
          // and beside "Could not load users" it reads as "there are none" --
          // the same confusion the catch block above already guards against by
          // keeping the error on the panel rather than only in a toast.
          count={loadError ? undefined : totalCount}
          noun="user"
        />
        {isAdmin && (
          <Button size="sm" onClick={() => setShowInvite(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            New User
          </Button>
        )}
      </div>

      <div className="bg-card rounded-lg border">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading…</div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
            <AlertCircle className="h-8 w-8 text-destructive opacity-80" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Could not load users</p>
              <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
            </div>
            <Button variant="outline" size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        ) : (
          <ItemsTable
            columns={columns}
            items={users}
            rowKey={(u) => u.id}
            onRowClick={(u) => router.push(`/users/${u.id}`)}
            emptyMessage="No users found"
          />
        )}
      </div>

      <Paginator
        page={page}
        totalPages={Math.ceil(totalCount / PAGE_SIZE)}
        onChange={setPage}
      />

      <InviteDialog open={showInvite} onOpenChange={setShowInvite} onInvited={load} />
    </div>
  )
}
