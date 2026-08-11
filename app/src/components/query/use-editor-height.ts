'use client'

// Persists the SQL editor pane's height across sessions. The drag/keyboard
// interaction itself now belongs to `ResizablePanelGroup`
// (see query-editor-split-pane.tsx): this hook only remembers the pixel
// height the analyst last settled on, the same way the hand-rolled drag
// handle used to on mouseup, except now it saves on every resize since
// react-resizable-panels does not expose a separate "drag ended" event to a
// controlled consumer the way the old mouseup listener did.
import { useCallback, useState } from 'react'

const STORAGE_KEY = 'queryEditorHeight'

export const DEFAULT_EDITOR_HEIGHT = 300
export const MIN_EDITOR_HEIGHT = 100
export const MAX_EDITOR_HEIGHT = 600

function readPersistedHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_HEIGHT
  const saved = localStorage.getItem(STORAGE_KEY)
  const parsed = saved ? parseInt(saved, 10) : NaN
  return Number.isFinite(parsed) ? parsed : DEFAULT_EDITOR_HEIGHT
}

export interface PersistedEditorHeight {
  /** Hand to the editor `ResizablePanel`'s `defaultSize`. Read once, at
   * mount: the panel owns the live value from then on. */
  defaultHeight: number
  /** Hand to that same panel's `onResize`, given the new height in pixels. */
  onResize: (heightPx: number) => void
}

export function usePersistedEditorHeight(): PersistedEditorHeight {
  const [defaultHeight] = useState(readPersistedHeight)

  const onResize = useCallback((heightPx: number) => {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, String(Math.round(heightPx)))
  }, [])

  return { defaultHeight, onResize }
}
