'use client'

import { Suspense, useId, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { CreateWithAiButton } from '@/components/ai/create-chat/create-with-ai-button'
import { PageHeader } from '@/components/layout/page-header'
import { ItemsTable, LIST_PAGE_SIZE, type Column } from '@/components/shared/items-table'
import { ListLoadError } from '@/components/shared/list-load-error'
import { ListPageTabs } from '@/components/shared/list-page-tabs'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { FavoritesControl } from '@/components/shared/favorites-control'
import { TimeAgo } from '@/components/shared/time-ago'
import { TagsControl } from '@/components/shared/tags-control'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useAllDashboards,
  useMyDashboards,
  useFavoriteDashboards,
  useArchivedDashboards,
  useCreateDashboard,
} from '@/hooks/use-dashboards'
import { DashboardRowActions } from './dashboard-row-actions'
import type { MockDashboard } from '@/lib/mock-data'
import { PageContainer } from '@/components/layout/page-container'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

const tabs = [
  { key: 'all', label: 'All Dashboards' },
  { key: 'my', label: 'My Dashboards' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'archive', label: 'Archive' },
]

export default function DashboardsPage() {
  return <Suspense><DashboardsContent /></Suspense>
}

function DashboardsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'all'
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const newNameId = useId()

  // useAllDashboards, not useDashboards: the table sorts and counts the set it
  // is given, so a single 25-row server page would have made "sort by name"
  // mean "sort these 25 by name". Paging happens in the table, over the whole
  // library.
  // Every tab gets the term. Passing it only to the first one left the box
  // dead on the other three while still showing a clear button and an
  // unfiltered count.
  const allDashboards = useAllDashboards({ search })
  const myDashboards = useMyDashboards({ search })
  const favoriteDashboards = useFavoriteDashboards({ search })
  // Archived dashboards appear in no other listing: Dashboard.all filters them
  // out, so this tab is the only route back to one.
  const archivedDashboards = useArchivedDashboards({ search })
  const createDashboard = useCreateDashboard()

  const dataMap = {
    all: allDashboards.data,
    my: myDashboards.data,
    favorites: favoriteDashboards.data,
    archive: archivedDashboards.data,
  }

  // The error branch has to follow the ACTIVE tab, not any single hook: each
  // tab has its own, and reading isError off `allDashboards` would report the
  // wrong tab's health while the reader looks at another.
  const statusMap = {
    all: allDashboards,
    my: myDashboards,
    favorites: favoriteDashboards,
    archive: archivedDashboards,
  }
  const activeQuery = statusMap[tab as keyof typeof statusMap]

  const active = dataMap[tab as keyof typeof dataMap]
  const items = active?.results ?? []
  // The read gives up at a page cap, and a list that silently stops is the bug
  // this page is fixing, so say so rather than let the last page look like the
  // end of the library.
  const truncated = active?.truncated === true

  const handleCreate = async () => {
    if (!newName.trim()) return
    const dashboard = await createDashboard.mutateAsync({ name: newName.trim() })
    setShowCreate(false)
    setNewName('')
    router.push(`/dashboards/${dashboard.id}`)
  }

  const columns: Column<MockDashboard>[] = [
    {
      key: 'favorite',
      title: '',
      width: 'w-10',
      render: (d) => (
        <FavoritesControl type="dashboards" id={d.id} isFavorite={d.is_favorite} />
      ),
    },
    {
      key: 'name',
      title: 'Name',
      sortValue: (d) => d.name,
      render: (d) => (
        <div>
          <Link
            href={`/dashboards/${d.id}`}
            className={ENTITY_NAME_CLASS}
            onClick={(e) => e.stopPropagation()}
          >
            {d.name}
          </Link>
          {d.tags.length > 0 && <TagsControl tags={d.tags} className="mt-1" />}
        </div>
      ),
    },
    {
      key: 'created_by',
      title: 'Created By',
      sortValue: (d) => d.user?.name ?? '',
      render: (d) => <span className="text-muted-foreground">{d.user?.name ?? '-'}</span>,
    },
    {
      key: 'created_at',
      title: 'Created At',
      sortValue: (d) => d.created_at,
      render: (d) => <TimeAgo date={d.created_at} className="text-muted-foreground" />,
    },
    // One trailing column on every tab, so the action never moves. What it
    // offers is the only thing that changes: Restore on the Archive tab,
    // Archive everywhere else, and nothing at all for a dashboard this person
    // may not modify.
    {
      key: 'actions',
      title: '',
      width: 'w-12',
      render: (d) => (
        <DashboardRowActions
          dashboard={d}
          intent={tab === 'archive' ? 'restore' : 'archive'}
        />
      ),
    },
  ]

  return (
    <PageContainer>
      {/* PageHeader's action slot is already `flex items-center gap-2`, so the
          two header buttons need no flex wrapper of their own: a fragment leaves
          the AI-off DOM byte-identical, since CreateWithAiButton renders null.
          The AI button sits first so New Dashboard keeps the position users
          reach for. */}
      <PageHeader
        title="Dashboards"
        description="Query results arranged on a grid, for watching rather than authoring."
        action={
          <>
            <CreateWithAiButton kind="dashboard" />
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              New Dashboard
            </Button>
          </>
        }
      />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search dashboards"
        placeholder="Search dashboards..."
        count={items.length}
        noun="dashboard"
        filters={
          <ListPageTabs
            tabs={tabs}
            active={tab}
            href={(key) => `/dashboards?tab=${key}`}
            label="Filter dashboards"
          />
        }
      />

      {truncated && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          This instance has more dashboards than this page reads. Search to narrow the list.
        </p>
      )}

      <div className="bg-card rounded-lg border">
        {activeQuery.isError ? (
          <ListLoadError noun="dashboards" onRetry={() => activeQuery.refetch()} />
        ) : (
          <ItemsTable
            columns={columns}
            items={items}
            rowKey={(d) => d.id}
            onRowClick={(d) => router.push(`/dashboards/${d.id}`)}
            emptyMessage="No dashboards found"
            pageSize={LIST_PAGE_SIZE}
            // A different tab or a different search is a different list, so it
            // opens at page 1 rather than wherever the reader was in the old one.
            pageKey={`${tab}|${search}`}
          />
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={(next) => { if (!next) setShowCreate(false) }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create a New Dashboard</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <Label htmlFor={newNameId} className="mb-1.5 block">Dashboard Name</Label>
            <Input
              id={newNameId}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Enter dashboard name..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createDashboard.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
