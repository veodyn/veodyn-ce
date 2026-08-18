'use client'

// The conversation itself: the bubbles, the chips offered with the newest
// reply, and what a failed turn offers instead.
//
// Renders as a run of MessageScrollerItems, so it must be mounted inside a
// MessageScrollerContent. The scroller owns the viewport and the scrolling.
//
// SECURITY: `reply` and `suggestedAnswers` are model output grounded on
// user-authored text, so they are untrusted. Render them as text children only:
// no dangerouslySetInnerHTML, no markdown renderer, no link detection (spec
// section 7).
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
   * Retry does NOT lock with the composer: it re-sends a turn the user already
   * spent rather than adding one, so the turn cap has no say in it.
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
          // No scrollAnchor on any row: that mode appends a spacer sized from
          // the viewport height, and this panel is sized by its content, so the
          // two inflate each other (see create-chat-dialog.tsx).
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
                  stamps role="button" on the anchor, so a screen reader is told
                  it navigates nowhere. Absent when the build has no by-hand
                  route for the kind, rather than linking into a 404. */}
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
        // In the reply's own place and bubble, so it reads as an answer
        // arriving rather than a status line.
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
