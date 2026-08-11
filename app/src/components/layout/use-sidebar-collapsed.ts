'use client'

// Whether the desktop rail is narrowed to icons, remembered per browser.
//
// `useSyncExternalStore` rather than "useState plus an effect that reads
// localStorage": the server has no localStorage, so the value has to come from
// somewhere React can reconcile. This gives it a server snapshot (expanded) and
// a client snapshot in one API, with no setState during an effect and no
// hydration mismatch. Subscribing to `storage` is a free bonus: narrow the rail
// in one tab and the others follow.
import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'sidebarCollapsed'

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // `storage` fires only in the OTHER tabs, which is exactly the case the local
  // listener set does not cover.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function getSnapshot(): boolean {
  return window.localStorage.getItem(KEY) === '1'
}

// A rail the reader has never touched starts open, and that is also what the
// server renders, so the first paint agrees with the markup either way.
function getServerSnapshot(): boolean {
  return false
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = useCallback(() => {
    window.localStorage.setItem(KEY, collapsed ? '0' : '1')
    // localStorage does not notify the tab that wrote it.
    for (const listener of listeners) listener()
  }, [collapsed])

  return [collapsed, toggle]
}
