'use client'

// The conversation itself: the bubbles, the chips offered with the newest
// reply, and what a failed turn offers instead.
//
// Renders as a run of MessageScrollerItems rather than its own element, so it
// has to be mounted inside a MessageScrollerContent. The scroller owns the
// viewport, which is why this file has no scrolling of its own: an unconditional
// "scroll to the end on every turn" is what it used to do, and that yanks the
// reader back down when the next reply lands while they are still on the last
// one.
//
// SECURITY: `reply` and `suggestedAnswers` are model output grounded on query
// names and column descriptions that users authored, so they are untrusted
// text. Every one of them is rendered as a text child and nothing else: no
// dangerouslySetInnerHTML, no markdown renderer, no link detection. A chip is a
// string to show, and clicking it sends that same string back as the next
// message. A steered model gets to write words, never markup (spec section 7).
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { cn } from '@/lib/utils'
import type { CreateKind } from '@/types/ai-create'
import { manualPath, openingPrompt, type ChatTurn } from './create-chat-model'

interface CreateChatTranscriptProps {
  kind: CreateKind
  turns: ChatTurn[]
  sending: boolean
  /** Chips send a message, so they lock exactly when the composer does. */
  locked: boolean
  /**
   * Retry does NOT lock with the composer. It re-sends a turn the user already
   * spent rather than adding one, so the turn cap has no say in it: the twelfth
   * message failing is exactly when being unable to retry hurts most.
   */
  retryLocked: boolean
  onAnswer: (text: string) => void
  onRetry: () => void
}

export function CreateChatTranscript({
  kind,
  turns,
  sending,
  locked,
  retryLocked,
  onAnswer,
  onRetry,
}: CreateChatTranscriptProps) {
  const manual = manualPath(kind)
  const lastSeq = turns[turns.length - 1]?.seq

  return (
    <>
      <MessageScrollerItem messageId="opening">
        <p className="text-pretty text-sm text-muted-foreground">{openingPrompt(kind)}</p>
      </MessageScrollerItem>

      {turns.map((turn) => (
        <MessageScrollerItem
          key={turn.seq}
          messageId={`turn-${turn.seq}`}
          // No scrollAnchor on any row. Lifting a turn to the top of the
          // viewport is a mode the scroller supports by appending a spacer
          // sized from the viewport's height, and this transcript lives in a
          // panel whose height is its content's, so the two inflate each other
          // (see the note in create-chat-dialog.tsx). The dialog follows the
          // bottom instead.
          className="flex flex-col gap-2"
        >
          <div
            className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm text-pretty whitespace-pre-wrap',
              turn.role === 'user'
                ? 'self-end bg-primary text-primary-foreground'
                : turn.failed
                  ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                  : 'bg-muted text-foreground'
            )}
          >
            {turn.content}
          </div>

          {turn.failed && (
            <div className="flex flex-wrap items-center gap-2">
              {/* The same turn, re-sent: it never reached the model, so it
                  does not cost one of the twelve. */}
              <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retryLocked}>
                Try again
              </Button>
              {/* A plain link, not a Button wrapping one: the Button primitive
                  stamps role="button" on the anchor, which tells a screen
                  reader this navigates nowhere when navigating is its job.
                  Absent when this build has no by-hand route for the kind,
                  which is what a community build answers for a KPI or a
                  report: Try again on its own beats a link into a 404. */}
              {manual != null && (
                <Link
                  href={manual.href}
                  className="text-sm underline underline-offset-2 hover:no-underline"
                >
                  {manual.label}
                </Link>
              )}
            </div>
          )}

          {turn.seq === lastSeq && turn.suggestedAnswers.length > 0 && (
            // Only the newest reply offers chips. An older reply's chips answer
            // a question the conversation has already moved past.
            <div className="flex flex-wrap gap-2">
              {turn.suggestedAnswers.map((answer) => (
                <Button
                  key={answer}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => onAnswer(answer)}
                >
                  {answer}
                </Button>
              ))}
            </div>
          )}
        </MessageScrollerItem>
      ))}

      {sending && (
        // The reply's own place, in the reply's own bubble: the turn in flight
        // is where the answer will be, so it reads as one arriving rather than a
        // status line floating between the transcript and the composer.
        <MessageScrollerItem messageId="thinking">
          <p className="flex w-fit items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Thinking
          </p>
        </MessageScrollerItem>
      )}
    </>
  )
}
