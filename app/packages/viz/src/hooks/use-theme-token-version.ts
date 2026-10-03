'use client'

import { useSyncExternalStore } from 'react'

// A counter that changes whenever the active token scope changes, for renderers
// that resolve CSS custom properties to concrete values and cache the result.
// MapLibre paints WebGL fills and cannot read a CSS variable, so a choropleth
// bakes hex into its feature collection; without this it keeps painting the
// previous theme until the data changes.
//
// It watches document.documentElement's class and data-theme rather than the
// React context, because the class is what decides which tokens
// getComputedStyle resolves, and authenticated-layout.tsx adds it in an effect
// that runs after the render which already read the old values.
let version = 0
const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!observer) {
    observer = new MutationObserver(() => {
      version += 1
      for (const l of listeners) l()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      observer?.disconnect()
      observer = null
    }
  }
}

export function useThemeTokenVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    // The server has no theme class to read, and a mismatch here would
    // re-render every subscriber on hydration.
    () => 0,
  )
}
