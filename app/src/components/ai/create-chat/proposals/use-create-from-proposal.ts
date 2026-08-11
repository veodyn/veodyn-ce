'use client'

// The commit lifecycle every proposal card shares: one create sequence at a
// time, the shell told when it is in flight so it can lock its composer, and a
// rejection kept on screen beside the proposal instead of losing it.
//
// It returns callbacks, never its setters. A setter that escapes a custom hook
// is not known-stable to the React Compiler, so every useCallback in a caller
// that closed over it would fail react-hooks/preserve-manual-memoization
// (../../../../../CLAUDE.md).
import { useState } from 'react'

/** What a card's commit does: create the objects, answer where to go. */
export type ProposalCommit = () => Promise<string | null>

export interface ProposalCommitHandle {
  /** True from the first write until the whole sequence settles. */
  busy: boolean
  /** The rejection that stopped the last attempt, or null. */
  error: unknown
  /** Run a commit. Ignored while one is already in flight. */
  start: (commit: ProposalCommit) => void
}

export function useCreateFromProposal(args: {
  onCreated: (href: string | null) => void
  onBusyChange: (busy: boolean) => void
}): ProposalCommitHandle {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  function start(commit: ProposalCommit) {
    // A second press while the first sequence runs would create the object
    // twice, and the first one has already been written by then.
    if (busy) return
    setBusy(true)
    setError(null)
    args.onBusyChange(true)
    commit().then(
      (href) => {
        setBusy(false)
        args.onBusyChange(false)
        args.onCreated(href)
      },
      (cause: unknown) => {
        // The proposal stays exactly as it was, so the user can fix a field or
        // retry rather than re-run the conversation.
        setBusy(false)
        args.onBusyChange(false)
        setError(cause)
      }
    )
  }

  return { busy, error, start }
}
