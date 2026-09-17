'use client'

import { ArrowRight, MessagesSquare, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { ChatComposer } from '@/components/chat/chat-composer'
import { CHAT_INTRO } from '@/components/chat/chat-home'
import { ChatStarters } from '@/components/chat/chat-starters'
import { UNTITLED_THREAD } from '@/components/chat/thread-list'
import { TimeAgo } from '@/components/shared/time-ago'
import { buttonVariants } from '@/components/ui/button'
import { useAiChatEnabled, useChatThreads } from '@/hooks/use-chat'
import { useStartChat } from '@/hooks/use-start-chat'
import { SECTION_HEADING } from '@/lib/section-heading'

export const RECENT_CHATS = 3

export function HomeChatCard() {
  const enabled = useAiChatEnabled()
  const threads = useChatThreads(enabled)
  const { start, starting, notice } = useStartChat()
  if (!enabled) return null
  const recent = (threads.data?.threads ?? []).slice(0, RECENT_CHATS)

  return (
    <section aria-labelledby="home-chat-heading" className="mb-10 rounded-lg border bg-card p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="size-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="home-chat-heading" className={SECTION_HEADING}>
            Ask about your data
          </h2>
          <p className="text-pretty text-sm text-muted-foreground">{CHAT_INTRO}</p>
        </div>
        <Link href="/chat" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Open Chat
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      <ChatComposer
        onSend={start}
        disabled={starting}
        sending={starting}
        notice={notice}
        placeholder="Ask a question about your data…"
      />
      <ChatStarters onPick={start} disabled={starting} className="mt-3" />
      {recent.length > 0 ? (
        <div className="mt-4 border-t pt-3">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Recent conversations</h3>
          <ul className="flex flex-col">
            {recent.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/chat/${thread.id}`}
                  className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <MessagesSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{thread.title || UNTITLED_THREAD}</span>
                  <TimeAgo date={thread.lastTurnAt} className="shrink-0 text-xs text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
