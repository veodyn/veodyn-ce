'use client'

// The Create-with-AI shell: the conversation, the composer, and the proposal
// card. Mounted only while open, because unmounting is how the conversation is
// discarded (there is no persistence, spec section 7).
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUp, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { MAX_MESSAGE_CHARS, type CreateKind } from '@/types/ai-create'
import {
  canSend,
  composerPlaceholder,
  composerState,
  dialogTitle,
  DISCARD_CONFIRM,
  manualPath,
} from './create-chat-model'
import { CreateChatTranscript } from './create-chat-transcript'
import { ProposalPanel } from './proposals/proposal-panel'
import { useCreateChat } from './use-create-chat'

export interface CreateChatDialogProps {
  kind: CreateKind
  onClose: () => void
  /** The dashboard being edited, when this is an edit rather than a creation. */
  targetDashboardId?: number
}

export function CreateChatDialog({ kind, onClose, targetDashboardId }: CreateChatDialogProps) {
  const router = useRouter()
  const chat = useCreateChat(kind, targetDashboardId)
  const [draft, setDraft] = useState('')
  // Reported by the proposal panel while it writes, so the composer cannot add
  // a turn to a conversation whose outcome is already being created.
  const [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const inputId = useId()
  const noticeId = useId()
  // Where the dialog puts the cursor when it opens, since the default lands on
  // the transcript's scroll region.
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const composer = composerState({ turns: chat.turns, sending: chat.sending, creating })
  const manual = manualPath(kind)

  function requestClose() {
    // A create in flight is not cancellable: the objects it has written already
    // exist. Closing waits for it.
    if (creating) return
    // A proposal on screen is uncommitted work: nothing is stored and nothing
    // resumes.
    if (chat.proposal != null) {
      setConfirming(true)
      return
    }
    onClose()
  }

  function submitDraft() {
    if (!canSend(draft, composer)) return
    chat.send(draft)
    setDraft('')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitDraft()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // A textarea so a long description wraps, but chat rules: Enter sends,
    // Shift+Enter starts a line.
    if (event.key !== 'Enter' || event.shiftKey) return
    // Mid-composition Enter accepts an IME candidate. Sending here would post
    // the half-typed word and lose the rest.
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    submitDraft()
  }

  function handleAnswer(text: string) {
    if (composer.disabled) return
    chat.send(text)
    setDraft('')
  }

  function handleCreated(href: string | null) {
    // The object exists; the conversation that proposed it has done its job.
    onClose()
    if (href != null) router.push(href)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <DialogContent
        size="lg"
        // Capped rather than fixed: the transcript scrolls inside the panel
        // instead of growing it until the composer is off the bottom, while a
        // two-turn conversation stays a short dialog.
        fill="max"
        // The page behind is the subject of the conversation: an edit turn
        // describes the dashboard it is opened over. Dimmed, not blurred.
        blurBackdrop={false}
        initialFocus={composerRef}
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle(kind)}</DialogTitle>
        </DialogHeader>
        {/* The scroller is the dialog's body. grow, not flex-1: flex-1 carries a
            flex-basis of 0, and the panel's height is its content's under
            `fill="max"`, so a basis of 0 is what it would size itself to. min-h-0
            because a flex item's automatic minimum size is its content.

            `end`, never the anchor mode: anchoring appends a spacer sized from
            the viewport's own height, which grows the content, which grows the
            content-sized panel, which asks for a taller spacer. Measured at 309px
            before a proposal card and 1329px after, 610px of it spacer, settling
            at the 85vh cap with the user's message clipped off the top. */}
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="min-h-0 grow">
            <MessageScrollerViewport aria-label="Conversation with the AI">
              <MessageScrollerContent className="gap-4">
                <CreateChatTranscript
                  kind={kind}
                  turns={chat.turns}
                  sending={chat.sending}
                  locked={composer.disabled}
                  // Not composer.disabled: retry re-sends a turn already spent, so the
                  // cap does not apply. Only a turn or a write in flight blocks it.
                  retryLocked={chat.sending || creating}
                  onAnswer={handleAnswer}
                  onRetry={chat.retry}
                />
                {chat.proposal != null && (
                  // Keyed on the sequence, so a revision is a new card rather
                  // than the old card's state wearing the new card's props:
                  // without it the name the user typed survives onto a proposal
                  // they have not seen, and that pair is what gets written.
                  <MessageScrollerItem
                    key={chat.proposalSeq}
                    messageId={`proposal-${chat.proposalSeq}`}
                  >
                    <ProposalPanel
                      proposal={chat.proposal}
                      targetDashboardId={targetDashboardId}
                      onCreated={handleCreated}
                      onBusyChange={setCreating}
                      // A revision is in flight, so creating from this card would
                      // write the thing the user just asked to change.
                      superseded={chat.sending}
                    />
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
        <DialogFooter>
          {confirming ? (
            <DiscardConfirm onKeep={() => setConfirming(false)} onDiscard={onClose} />
          ) : (
            <form className="flex w-full flex-col gap-2" onSubmit={handleSubmit}>
              <Label htmlFor={inputId} className="sr-only">
                Message the AI
              </Label>
              {/* The chat composer shape: text above its own controls, sending
                  as the round arrow in the corner. The spinner replaces the
                  arrow so the control keeps its size and place in flight. */}
              <InputGroup>
                <InputGroupTextarea
                  ref={composerRef}
                  id={inputId}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={composerPlaceholder(kind)}
                  maxLength={MAX_MESSAGE_CHARS}
                  disabled={composer.disabled}
                  rows={1}
                  // field-sizing-content grows the box with what is typed; the
                  // cap is what stops a pasted essay from taking the panel.
                  className="max-h-32 min-h-9"
                  aria-describedby={composer.notice == null ? undefined : noticeId}
                />
                <InputGroupAddon align="block-end" className="justify-end">
                  <IconButton
                    type="submit"
                    tooltip="Send"
                    size="icon"
                    className="rounded-full"
                    disabled={!canSend(draft, composer)}
                    aria-busy={chat.sending}
                  >
                    {chat.sending ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ArrowUp aria-hidden="true" />
                    )}
                  </IconButton>
                </InputGroupAddon>
              </InputGroup>
              {composer.notice != null && (
                <p id={noticeId} className="text-pretty text-xs text-muted-foreground">
                  {composer.notice}{' '}
                  {composer.atCap && manual != null && (
                    <Link href={manual.href} className="underline underline-offset-2">
                      {manual.label}
                    </Link>
                  )}
                </p>
              )}
            </form>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Inline rather than a nested ConfirmDialog: it takes the composer's place
// instead of stacking a second dialog on top of this one.
function DiscardConfirm({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <p role="alert" className="text-pretty text-sm">
        <span className="font-medium">{DISCARD_CONFIRM.title}</span>{' '}
        {DISCARD_CONFIRM.description}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onKeep}>
          Keep chatting
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onDiscard}>
          {DISCARD_CONFIRM.confirmLabel}
        </Button>
      </div>
    </div>
  )
}
