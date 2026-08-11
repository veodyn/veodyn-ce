'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

// Degrades to static (true) when matchMedia is unavailable so motion never
// starts on a surface that cannot report the preference.
function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia(QUERY).matches
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
