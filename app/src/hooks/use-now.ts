'use client'

import { useSyncExternalStore } from 'react'

/**
 * A clock, as an external store.
 *
 * Two callers need one and for the same reason. TimeAgo has always ticked, so
 * "2 minutes ago" does not sit frozen. FreshnessBadge derives Fresh/Stale/Down
 * from how old a dataset is, and it did not tick: a badge mounted just inside
 * two cadence periods stayed Fresh after crossing into Stale until some
 * unrelated render came along. A verdict that decays with time has to be
 * recomputed as time passes, not only when a parent happens to re-render.
 *
 * useSyncExternalStore rather than useState in an effect: time is external
 * state, and setting state synchronously from an effect is a cascading render.
 * One interval is shared across every subscriber, so a catalog page rendering a
 * dozen badges still runs a single timer.
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
// markup. Callers read zero as "no clock yet" and fall back to reading the time
// directly, which is what these components did before there was a store.
function getServerSnapshot(): number {
  return 0
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
