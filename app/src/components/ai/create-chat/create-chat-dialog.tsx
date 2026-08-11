'use client'

// The Create-with-AI shell: the conversation, the composer, and the proposal
// card once the model has one. Mounted only while open, because unmounting is
// how the conversation is discarded (there is no persistence, spec section 7).
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
  // Where the dialog puts the cursor when it opens. Without it focus lands on
  // the first tabbable thing in the panel, which is the transcript's scroll
  // region, and the first thing anyone does here is type.
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const composer = composerState({ turns: chat.turns, sending: chat.sending, creating })
  const manual = manualPath(kind)

  function requestClose() {
    // A create in flight is not cancellable: the objects it has already written
    // exist, and unmounting here would route the user somewhere after they
    // asked to leave, or leave a half-built dashboard with nobody told. Closing
    // waits for it, which is a second at most.
    if (creating) return
    // A proposal on screen is work the user has not committed and cannot get
    // back: nothing is stored and nothing resumes.
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
    // The composer is a textarea so a long description can wrap instead of
    // scrolling sideways through one line, but this is a chat: Enter sends and
    // Shift+Enter starts a line. A textarea would otherwise swallow the key
    // that every other chat submits with.
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
        // instead of growing it turn after turn until the composer is off the
        // bottom of the screen, but a conversation two turns in is still a
        // short dialog rather than four hundred pixels of reply sitting at the
        // top of an empty one.
        fill="max"
        // The page behind is the subject of the conversation, not something to
        // get out of the way: an edit turn describes the dashboard it is opened
        // over, and a dashboard nobody can read is a poor thing to be asked
        // questions about. Dimmed, not blurred.
        blurBackdrop={false}
        // Straight into the composer. The default lands on the first tabbable
        // element, which here is the transcript's scroll region, so the reader
        // had to click the box before typing the message they opened this to
        // send.
        initialFocus={composerRef}
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle(kind)}</DialogTitle>
        </DialogHeader>
        {/* The scroller is the dialog's body: DialogContent has no scrolling
            region of its own, only a header/body/footer stack sharing one flex
            column. grow, not flex-1: flex-1 carries a flex-basis of 0, and the
            panel's height is its content's under `fill="max"`, so a basis of 0
            is what the panel would size itself to. min-h-0 goes with it, since
            a flex item's automatic minimum size is its content and without it
            this region refuses to shrink below its children.

            Follow the bottom; do NOT anchor a turn to the top of the viewport.
            Anchoring is the scroller's other mode, and it is the one mode a
            content-sized panel cannot host: to lift a turn to the top the
            primitive appends a spacer sized from the viewport's own height, the
            spacer grows the content, the content grows the panel, and the taller
            panel asks for a taller spacer. It settles at the 85vh cap with a
            screenful of nothing under the last turn and the user's own message
            clipped off the top -- measured at 309px before a proposal card and
            1329px after, 610px of it spacer. `end` never sizes the spacer at
            all, so the panel is the conversation's height until the cap and
            scrolls after it. autoScroll still follows a reply only while the
            reader is at the live edge and backs off the moment they scroll up;
            the scroll button it renders is how they get back. */}
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
                  // they have not seen, and that pair is what gets written. A
                  // row rather than loose content so the scroller can address
                  // it, and the card's own Create button is what the scroller
                  // brings into view: it sits at the bottom of the card, which
                  // is where following the bottom lands.
                  <MessageScrollerItem
                    key={chat.proposalSeq}
                    messageId={`proposal-${chat.proposalSeq}`}
                  >
                    <ProposalPanel
                      proposal={chat.proposal}
                      targetDashboardId={targetDashboardId}
                      onCreated={handleCreated}
                      onBusyChange={setCreating}
                      // A revision is in flight, so this card is already out of date.
                      // Creating from it writes the thing the user just asked to
                      // change, and the answer that would have corrected it is aborted
                      // by the navigation that follows.
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
              {/* The chat composer shape, not a one-line field with a labelled
                  button beside it: the text sits above its own controls, and
                  sending is the round arrow every chat puts in that corner. The
                  spinner replaces the arrow rather than pushing a word in next
                  to it, so the control keeps its size and its place while a
                  turn is in flight. */}
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

// Inline rather than a nested ConfirmDialog: the confirmation takes the
// composer's place instead, where the user is already looking, rather than
// stacking a second dialog on top of this one.
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
