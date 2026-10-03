'use client'

import { useCallback, useSyncExternalStore } from 'react'

interface Watch {
  version: number
  listeners: Set<() => void>
  observer: MutationObserver | null
}

const watches = new Map<Element, Watch>()

function watchFor(target: Element): Watch {
  let watch = watches.get(target)
  if (!watch) {
    watch = { version: 0, listeners: new Set(), observer: null }
    watches.set(target, watch)
  }
  return watch
}

function subscribeTo(target: Element, listener: () => void): () => void {
  const watch = watchFor(target)
  watch.listeners.add(listener)
  if (!watch.observer) {
    watch.observer = new MutationObserver(() => {
      watch.version += 1
      for (const l of watch.listeners) l()
    })
    watch.observer.observe(target, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  }
  return () => {
    watch.listeners.delete(listener)
    if (watch.listeners.size === 0) {
      watch.observer?.disconnect()
      watches.delete(target)
    }
  }
}

function targetOf(root: Element | null | undefined): Element | null {
  if (root) return root
  return typeof document === 'undefined' ? null : document.documentElement
}

export function useThemeTokenVersion(root?: Element | null): number {
  const target = targetOf(root)
  const subscribe = useCallback(
    (listener: () => void) => (target ? subscribeTo(target, listener) : () => {}),
    [target]
  )
  return useSyncExternalStore(
    subscribe,
    () => (target ? (watches.get(target)?.version ?? 0) : 0),
    () => 0
  )
}
