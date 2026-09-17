'use client'

import { ArrowUp, Loader2 } from 'lucide-react'
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { IconButton } from '@/components/shared/icon-button'
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'

export const MAX_CHAT_MESSAGE_CHARS = 4_000

interface ChatComposerProps {
  onSend: (text: string) => void
  disabled: boolean
  sending: boolean
  notice?: string | null
  placeholder?: string
}

export function ChatComposer({ onSend, disabled, sending, notice, placeholder }: ChatComposerProps) {
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const noticeId = useId()
  const ready = draft.trim().length > 0 && !disabled

  const submit = () => {
    if (!ready) return
    onSend(draft)
    setDraft('')
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form className="flex w-full flex-col gap-2" onSubmit={handleSubmit}>
      <Label htmlFor={inputId} className="sr-only">
        Ask about your data
      </Label>
      <InputGroup>
        <InputGroupTextarea
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? 'Ask a question about your data'}
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          rows={1}
          className="max-h-40 min-h-9"
          aria-describedby={notice ? noticeId : undefined}
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <IconButton
            type="submit"
            tooltip="Send"
            size="icon"
            className="rounded-full"
            disabled={!ready}
            aria-busy={sending}
          >
            {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
          </IconButton>
        </InputGroupAddon>
      </InputGroup>
      {notice ? (
        <p id={noticeId} role="status" className="text-pretty text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </form>
  )
}
