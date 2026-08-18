'use client'

import { useSyncExternalStore } from 'react'

/**
 * A clock, as an external store. Verdicts that decay with time (TimeAgo's
 * "2 minutes ago", FreshnessBadge's Fresh/Stale/Down) have to recompute as time
 * passes, not only when a parent re-renders. One interval is shared across every
 * subscriber, so a catalog page rendering a dozen badges runs a single timer.
 */
const TICK_MS = 60_000

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let current = 0

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  if (timer === null) {
    // React re-reads the snapshot right after subscribing, so seeding here is
    // what gets the first real timestamp on screen without waiting a full tick.
    current = Date.now()
    timer = setInterval(() => {
      current = Date.now()
      for (const listener of listeners) listener()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(onStoreChange)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot(): number {
  return current
}

// Zero on the server and on the hydrating render, so both produce identical
// markup. Callers read zero as "no clock yet" and read the time directly.
function getServerSnapshot(): number {
  return 0
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
