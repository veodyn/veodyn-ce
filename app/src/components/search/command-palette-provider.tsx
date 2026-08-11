'use client'

import { Suspense, lazy, useMemo, useState } from 'react'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'

// Loaded on demand. The palette is mounted by the authenticated shell, so it
// sat in the entry graph of every signed-in route, and it brings cmdk with it:
// 48 KB to serve a keystroke most sessions never press. What has to be eager is
// the SHORTCUT, which is this component, and it is a keydown listener.
const CommandPalette = lazy(() =>
  import('@/components/search/command-palette').then((m) => ({ default: m.CommandPalette }))
)

/**
 * Mounts the global command palette once and toggles it on mod+k. Rendered only
 * inside the authenticated shell branch, so it never binds on the embed,
 * public-dashboard, or token routes.
 */
export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false)
  // Sticky rather than derived from `open`, so the palette stays mounted once
  // it has been opened. Unmounting on close would drop the dialog's exit
  // animation and re-run its hooks on every reopen, and CommandPalette is
  // written on the assumption that it goes on rendering while closed: see the
  // idle-query invariant its own test pins.
  const [everOpened, setEverOpened] = useState(false)

  const shortcuts = useMemo(
    () => ({
      'mod+k': () => {
        setEverOpened(true)
        setOpen((prev) => !prev)
      },
    }),
    []
  )
  useKeyboardShortcuts(shortcuts)

  if (!everOpened) return null

  // No fallback: the palette is a dialog over the page, so a skeleton in its
  // place would be a flash of nothing anchored to nothing. The chunk resolves
  // within a frame or two of the keypress and the dialog opens then.
  return (
    <Suspense fallback={null}>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </Suspense>
  )
}
