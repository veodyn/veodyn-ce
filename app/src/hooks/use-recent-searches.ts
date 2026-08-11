'use client'

import { useCallback, useSyncExternalStore } from 'react'

export const RECENTS_KEY = 'veodyn.search.recents'
export const RECENTS_CAP = 8

// localStorage is an external store, so it is read through
// useSyncExternalStore rather than mirrored into state. That keeps the server
// snapshot empty (no hydration mismatch) without a setState-in-effect.

const EMPTY: string[] = []

const listeners = new Set<() => void>()

// The last raw string seen in storage, paired with the parsed array handed to
// React. getSnapshot must return a stable reference or React re-renders
// forever, so the parse result is cached until the raw string actually moves.
let lastRaw: string | null | undefined
let snapshot: string[] = EMPTY

function safeGetItem(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(RECENTS_KEY)
  } catch {
    return null
  }
}

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENTS_CAP)
  } catch {
    // Corrupt JSON. Recents are a convenience, so an unreadable list degrades
    // to an empty one rather than breaking the search page.
    return EMPTY
  }
}

/** Returns false when the browser refused the write (quota, storage disabled). */
function persist(terms: string[]): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(terms))
    return true
  } catch {
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // A storage event fires only for changes made in another tab, so this is
  // what keeps a second tab's recents from going stale.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function getSnapshot(): string[] {
  const raw = safeGetItem()
  if (raw !== lastRaw) {
    lastRaw = raw
    snapshot = parse(raw)
  }
  return snapshot
}

function getServerSnapshot(): string[] {
  return EMPTY
}

function mutate(next: string[]): void {
  snapshot = next
  // On a refused write, re-sync lastRaw to what storage still holds so the
  // next getSnapshot sees no change and keeps serving the in-memory list.
  lastRaw = persist(next) ? JSON.stringify(next) : safeGetItem()
  listeners.forEach((listener) => listener())
}

export interface RecentSearches {
  recents: string[]
  record: (term: string) => void
  remove: (term: string) => void
  clear: () => void
}

export function useRecentSearches(): RecentSearches {
  const recents = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const record = useCallback((term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    const current = getSnapshot()
    const next = [
      trimmed,
      ...current.filter((t) => t.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, RECENTS_CAP)
    // Recording the same term twice in a row is a no-op, which matters because
    // the page records on every settled search.
    if (next.length === current.length && next.every((t, i) => t === current[i])) return
    mutate(next)
  }, [])

  const remove = useCallback((term: string) => {
    const current = getSnapshot()
    const next = current.filter((t) => t.toLowerCase() !== term.toLowerCase())
    if (next.length === current.length) return
    mutate(next)
  }, [])

  const clear = useCallback(() => {
    if (getSnapshot().length === 0) return
    mutate([])
  }, [])

  return { recents, record, remove, clear }
}
