'use client'

import { Sparkles } from 'lucide-react'
import { BigMessage } from '@/components/shared/big-message'
import { Slot } from '@/features/slots'
import { useStartChat } from '@/hooks/use-start-chat'
import { useSubjectLabel } from '@/hooks/use-thread-subject-label'
import type { ChatThreadSubject } from '@/lib/chat/wire'
import { ChatComposer } from './chat-composer'
import { ChatStarters } from './chat-starters'

export { START_FAILED_MESSAGE } from '@/hooks/use-start-chat'

export const CHAT_INTRO =
  'Questions about your data, and about the queries and dashboards already here, are answered in a conversation. ' +
  'Queries run in your browser with your own permissions, and results worth keeping can be saved.'

const GENERAL_PLACEHOLDER = 'Which routes lost the most riders this month?'

export function ChatHome({ subject = null }: { subject?: ChatThreadSubject | null }) {
  const { start, starting, notice } = useStartChat()
  const subjectLabel = useSubjectLabel(subject)
  const send = (text: string) => start(text, subject ?? undefined)

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
        onSend={send}
        disabled={starting}
        sending={starting}
        notice={notice}
        placeholder={subject ? subjectLabel : GENERAL_PLACEHOLDER}
      />
      {subject ? null : (
        <Slot
          id="chat.starters"
          props={{ onPick: send, disabled: starting }}
          fallback={<ChatStarters onPick={send} disabled={starting} />}
        />
      )}
    </div>
  )
}
