'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessagesSquare, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { IconButton } from '@/components/shared/icon-button'
import { ListLoadError } from '@/components/shared/list-load-error'
import { buttonVariants } from '@/components/ui/button'
import { NoData } from '@/components/ui/no-data'
import { useChatThreads, useDeleteChatThread, useUpdateChatThread } from '@/hooks/use-chat'
import type { ChatThread } from '@/lib/chat/wire'
import { cn } from '@/lib/utils'

export const UNTITLED_THREAD = 'New conversation'

interface ThreadListProps {
  activeId: string | null
}

export function ThreadList({ activeId }: ThreadListProps) {
  const router = useRouter()
  const threads = useChatThreads(true)
  const update = useUpdateChatThread()
  const remove = useDeleteChatThread()
  const [pendingDelete, setPendingDelete] = useState<ChatThread | null>(null)

  const confirmDelete = () => {
    if (!pendingDelete) return
    const thread = pendingDelete
    remove.mutate(thread.id, {
      onSuccess: () => {
        setPendingDelete(null)
        if (thread.id === activeId) router.push('/chat')
      },
    })
  }

  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <Link href="/chat" className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start')}>
          <Plus aria-hidden="true" />
          New conversation
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {threads.isPending ? (
          <div role="status" aria-label="Loading conversations" className="flex animate-pulse flex-col gap-2 px-2">
            <div className="h-7 rounded-md bg-muted" />
            <div className="h-7 rounded-md bg-muted" />
            <div className="h-7 rounded-md bg-muted" />
          </div>
        ) : null}
        {threads.isError ? <ListLoadError noun="conversations" onRetry={() => void threads.refetch()} /> : null}
        {threads.data?.threads.length === 0 ? (
          <NoData message="No conversations yet." icon={<MessagesSquare className="mb-3 size-8 opacity-50" />} />
        ) : null}
        <ul className="flex flex-col gap-0.5">
          {threads.data?.threads.map((thread) => {
            const title = thread.title || UNTITLED_THREAD
            return (
              <li
                key={thread.id}
                className={cn(
                  'group flex items-center gap-1 rounded-md pr-1 text-sm transition-colors',
                  thread.id === activeId
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <Link
                  href={`/chat/${thread.id}`}
                  aria-current={thread.id === activeId ? 'page' : undefined}
                  className="min-w-0 flex-1 truncate px-2 py-1.5"
                >
                  {thread.pinned ? <Pin className="mr-1 inline size-3" aria-label="Pinned" /> : null}
                  {title}
                </Link>
                <IconButton
                  tooltip={thread.pinned ? 'Unpin' : 'Pin'}
                  aria-label={`${thread.pinned ? 'Unpin' : 'Pin'} ${title}`}
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => update.mutate({ id: thread.id, patch: { pinned: !thread.pinned } })}
                >
                  {thread.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                </IconButton>
                <IconButton
                  tooltip="Delete"
                  aria-label={`Delete ${title}`}
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => setPendingDelete(thread)}
                >
                  <Trash2 aria-hidden="true" />
                </IconButton>
              </li>
            )
          })}
        </ul>
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
          title="Delete conversation?"
          description={`"${pendingDelete.title || UNTITLED_THREAD}" and its messages will be deleted. This cannot be undone.`}
          isPending={remove.isPending}
          onConfirm={confirmDelete}
        />
      ) : null}
    </nav>
  )
}
