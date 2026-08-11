'use client'

import { useEffect, useState } from 'react'

interface UseDeckCycleOptions {
  count: number
  dwellMs: number
  enabled: boolean
}

interface UseDeckCycleResult {
  index: number
  next: () => void
  prev: () => void
  goTo: (i: number) => void
  paused: boolean
  setPaused: (paused: boolean) => void
}

// Drives Wall's auto-advancing slide index. Present reuses the index/next/prev/goTo
// surface with `enabled: false` so it advances only on keystroke, never on a timer.
export function useDeckCycle({ count, dwellMs, enabled }: UseDeckCycleOptions): UseDeckCycleResult {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  // Every advance normalizes the current stored index into range FIRST. When
  // `count` shrinks below a stale stored index, advancing from the raw stale
  // value would land on the same slide repeatedly; clamping first makes next
  // and prev move correctly relative to what is actually displayed.
  const clamp = (i: number) => (count > 0 ? Math.min(Math.max(i, 0), count - 1) : 0)

  useEffect(() => {
    if (!enabled || paused || count <= 1) return undefined

    const id = setInterval(() => {
      setIndex((i) => (Math.min(Math.max(i, 0), count - 1) + 1) % count)
    }, dwellMs)

    return () => clearInterval(id)
  }, [enabled, paused, count, dwellMs])

  function next(): void {
    if (count === 0) return
    setIndex((i) => (clamp(i) + 1) % count)
  }

  function prev(): void {
    if (count === 0) return
    setIndex((i) => (clamp(i) - 1 + count) % count)
  }

  function goTo(target: number): void {
    if (count === 0) return
    setIndex(clamp(target))
  }

  // Also clamp for the return value so a shrunk count reads in range immediately,
  // before the next advance normalizes the stored state.
  return { index: clamp(index), next, prev, goTo, paused, setPaused }
}
