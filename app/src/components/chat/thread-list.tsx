'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import { buttonVariants } from '@/components/ui/button'
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

  const handleDelete = (thread: ChatThread) => {
    remove.mutate(thread.id, {
      onSuccess: () => {
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
        {threads.isPending ? <p className="px-2 text-xs text-muted-foreground">Loading…</p> : null}
        {threads.isError ? <p className="px-2 text-xs text-destructive">Conversations could not be loaded.</p> : null}
        {threads.data?.threads.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No conversations yet.</p>
        ) : null}
        <ul className="flex flex-col gap-0.5">
          {threads.data?.threads.map((thread) => {
            const title = thread.title || UNTITLED_THREAD
            return (
              <li
                key={thread.id}
                className={cn(
                  'group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted',
                  thread.id === activeId && 'bg-muted font-medium'
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
                  onClick={() => handleDelete(thread)}
                >
                  <Trash2 aria-hidden="true" />
                </IconButton>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
