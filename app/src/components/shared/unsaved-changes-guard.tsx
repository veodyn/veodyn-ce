'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'

interface UnsavedChangesGuardProps {
  isDirty: boolean
  /** What is at stake, in this screen's own words. */
  title?: string
  description?: string
  /** The verb for leaving anyway. */
  confirmLabel?: string
}

/**
 * Ask before leaving a screen with unsaved work, whichever way the person goes.
 *
 * `beforeunload` alone covered only half of it. Typing SQL into a new query and
 * then editing the address bar raised the browser's own "Leave site?" prompt,
 * while clicking Dashboards in the sidebar discarded the draft immediately and
 * silently. Same unsaved work, opposite outcome, decided by which of the two
 * navigation mechanisms happened to be used, and the sidebar is how people
 * actually move around this app.
 *
 * The in-app half is a capture-phase listener on the document rather than a
 * router hook, because the App Router has no navigation blocker to hook. Capture
 * is what makes it work: the event is stopped at the document, before it reaches
 * React's root listener and before Next's Link handler ever sees it, so the
 * navigation does not start and then get undone.
 *
 * Deliberately narrow about what it intercepts. A modified click (a new tab), a
 * download, an external host, a `target`, and a link back to the page you are
 * already on all pass straight through: none of them abandons the draft, and a
 * dialog in front of "open in new tab" would be a guard that cries wolf.
 *
 * It cannot see a `router.push` from a button, since there is no DOM event to
 * catch. Anchors are what the sidebar, the library rows and the breadcrumbs all
 * are, which is the reported gap and the great majority of the real ones.
 */
export function UnsavedChangesGuard({
  isDirty,
  title = 'Leave without saving?',
  description = 'This page has changes that have not been saved. Leaving now discards them.',
  confirmLabel = 'Discard changes',
}: UnsavedChangesGuardProps) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  // The hard-navigation half: reloads, the address bar, closing the tab.
  useUnsavedChanges(isDirty)

  useEffect(() => {
    if (!isDirty) return
    const onClick = (event: MouseEvent) => {
      // Something closer to the target has already handled it.
      if (event.defaultPrevented) return
      // A middle click or any modifier opens elsewhere and leaves this page
      // exactly where it is.
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (anchor == null) return
      const href = anchor.getAttribute('href')
      if (href == null || href === '') return
      if (anchor.hasAttribute('download')) return
      if (anchor.target !== '' && anchor.target !== '_self') return
      const url = new URL(href, window.location.href)
      if (url.origin !== window.location.origin) return
      // An in-page anchor, or a link back to where we already are, changes
      // nothing and must not be guarded.
      const here = `${window.location.pathname}${window.location.search}`
      const there = `${url.pathname}${url.search}`
      if (there === here) return

      event.preventDefault()
      event.stopPropagation()
      setPendingHref(`${there}${url.hash}`)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [isDirty])

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open) setPendingHref(null)
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel="Keep editing"
      onConfirm={() => {
        const href = pendingHref
        // Cleared first: the guard is about to unmount with the navigation, and
        // a dialog still holding an href would flash back if it does not.
        setPendingHref(null)
        if (href !== null) router.push(href)
      }}
    />
  )
}
