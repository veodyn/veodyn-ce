'use client'

import { Sparkles } from 'lucide-react'
import { BigMessage } from '@/components/shared/big-message'
import { useStartChat } from '@/hooks/use-start-chat'
import { ChatComposer } from './chat-composer'
import { ChatStarters } from './chat-starters'

export { START_FAILED_MESSAGE } from '@/hooks/use-start-chat'

export const CHAT_INTRO =
  'Questions about your data, and about the queries and dashboards already here, are answered in a conversation. ' +
  'Queries run in your browser with your own permissions, and results worth keeping can be saved.'

export function ChatHome() {
  const { start, starting, notice } = useStartChat()

  return (
    <div className="flex h-full w-full max-w-3xl flex-col justify-center gap-6 px-6 py-10">
      <BigMessage
        icon={<Sparkles className="size-10" aria-hidden="true" />}
        message="Ask anything about your data"
        className="py-0"
      >
        <p className="text-pretty text-sm text-muted-foreground">{CHAT_INTRO}</p>
      </BigMessage>
      <ChatComposer
        onSend={start}
        disabled={starting}
        sending={starting}
        notice={notice}
        placeholder="Which routes lost the most riders this month?"
      />
      <ChatStarters onPick={start} disabled={starting} />
    </div>
  )
}
