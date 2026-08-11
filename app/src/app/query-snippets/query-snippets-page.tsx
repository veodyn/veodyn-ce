'use client'

import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { CreateWithAiButton } from '@/components/ai/create-chat/create-with-ai-button'
import { PageHeader } from '@/components/layout/page-header'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { RowActionsMenu, type RowAction } from '@/components/shared/row-actions-menu'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useQuerySnippets, useCreateSnippet, useDeleteSnippet } from '@/hooks/use-query-snippets'
import { matchesSearch } from '@/lib/list-filter'
import { removalCopy } from '@/lib/removal'
import { useAuthStore } from '@/stores/auth-store'
import type { MockQuerySnippet } from '@/lib/mock-data'
import { PageContainer } from '@/components/layout/page-container'

export function QuerySnippetsPage() {
  const { data: snippets } = useQuerySnippets()
  const createSnippet = useCreateSnippet()
  const deleteSnippet = useDeleteSnippet()
  const currentUser = useAuthStore((s) => s.currentUser)
  const toast = useToast()
  const [pendingDelete, setPendingDelete] = useState<MockQuerySnippet | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [trigger, setTrigger] = useState('')
  const [description, setDescription] = useState('')
  const [snippet, setSnippet] = useState('')
  const [search, setSearch] = useState('')
  const triggerId = useId()
  const descriptionId = useId()
  const snippetId = useId()

  const visible = (snippets ?? []).filter((s) =>
    matchesSearch(search, [s.trigger, s.description, s.snippet])
  )

  const handleCreate = async () => {
    if (!trigger.trim() || !snippet.trim()) return
    await createSnippet.mutateAsync({ trigger: trigger.trim(), description: description.trim(), snippet: snippet.trim() })
    setShowCreate(false)
    setTrigger('')
    setDescription('')
    setSnippet('')
  }

  // Redash's QuerySnippetResource.delete calls require_admin_or_owner(
  // snippet.user.id), so anyone else was being shown a trash can that could
  // only ever return 403. Nothing is offered instead of something that fails:
  // RowActionsMenu renders no kebab at all for an empty list.
  const actionsFor = (s: MockQuerySnippet): RowAction[] => {
    const mine = currentUser != null && s.user.id === currentUser.id
    if (!mine && currentUser?.isAdmin !== true) return []
    return [
      {
        key: 'delete',
        label: removalCopy('snippet', s.trigger).verb,
        icon: Trash2,
        onSelect: () => setPendingDelete(s),
        destructive: true,
      },
    ]
  }

  // The row menu and the confirmation are handed the same sentence from
  // lib/removal, so the menu cannot promise one thing and the dialog another.
  const deleteCopy = removalCopy('snippet', pendingDelete?.trigger)

  const columns: Column<MockQuerySnippet>[] = [
    {
      key: 'trigger',
      title: 'Trigger',
      render: (s) => <span className="font-mono text-primary">{s.trigger}</span>,
    },
    {
      key: 'description',
      title: 'Description',
      render: (s) => <span className="text-muted-foreground">{s.description}</span>,
    },
    {
      key: 'snippet',
      title: 'Snippet',
      render: (s) => <span className="font-mono text-xs max-w-xs truncate block">{s.snippet}</span>,
    },
    {
      key: 'actions',
      title: '',
      width: 'w-12',
      render: (s) => (
        <RowActionsMenu label={`Actions for ${s.trigger}`} actions={actionsFor(s)} />
      ),
    },
  ]

  return (
    <PageContainer>
      {/* PageHeader's action slot is already `flex items-center gap-2`, so the
          two header buttons need no flex wrapper of their own: a fragment leaves
          the AI-off DOM byte-identical, since CreateWithAiButton renders null.
          The AI button sits first so New Snippet keeps the position users reach
          for. */}
      <PageHeader
        title="Query Snippets"
        description="Reusable SQL fragments, expanded by typing their trigger in the editor or inserted from the Snippets panel beside it."
        action={
          <>
            <CreateWithAiButton kind="snippet" />
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              New Snippet
            </Button>
          </>
        }
      />
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search snippets"
        placeholder="Search by trigger or description..."
        count={visible.length}
        noun="snippet"
      />
      <div className="bg-card rounded-lg border">
        <ItemsTable
          columns={columns}
          items={visible}
          rowKey={(s) => s.id}
          emptyMessage="No query snippets"
        />
      </div>
      <Dialog open={showCreate} onOpenChange={(next) => { if (!next) setShowCreate(false) }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>New Query Snippet</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            <div>
              <Label htmlFor={triggerId} className="mb-1 block">Trigger</Label>
              <Input
                id={triggerId}
                type="text"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                placeholder="e.g. last7d"
              />
            </div>
            <div>
              <Label htmlFor={descriptionId} className="mb-1 block">Description</Label>
              <Input
                id={descriptionId}
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={snippetId} className="mb-1 block">Snippet</Label>
              <Textarea
                id={snippetId}
                className="font-mono"
                value={snippet}
                onChange={(e) => setSnippet(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!trigger.trim() || !snippet.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={deleteCopy.title}
        description={deleteCopy.description}
        confirmLabel={deleteCopy.verb}
        isPending={deleteSnippet.isPending}
        onConfirm={() => {
          const target = pendingDelete
          if (!target) return
          deleteSnippet.mutate(target.id, {
            onSuccess: () => {
              setPendingDelete(null)
              toast.success(`Deleted "${target.trigger}".`)
            },
            onError: (error) => {
              setPendingDelete(null)
              toast.error(
                error instanceof Error ? error.message : `Could not delete "${target.trigger}".`
              )
            },
          })
        }}
      />
    </PageContainer>
  )
}
