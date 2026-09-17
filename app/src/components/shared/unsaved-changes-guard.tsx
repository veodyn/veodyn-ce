'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

interface UnsavedChangesGuardProps {
  isDirty: boolean
  /** What is at stake, in this screen's own words. */
  title?: string
  description?: string
  /** The verb for leaving anyway. */
  confirmLabel?: string
}

export function UnsavedChangesGuard({
  isDirty,
  title = 'Leave without saving?',
  description = 'This page has changes that have not been saved. Leaving now discards them.',
  confirmLabel = 'Discard changes',
}: UnsavedChangesGuardProps) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    if (!isDirty) return
    const onClick = (event: MouseEvent) => {
      // Something closer to the target has already handled it.
      if (event.defaultPrevented) return
      // A middle click or any modifier opens elsewhere and leaves this page.
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
      // nothing.
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
        // Cleared first: the guard unmounts with the navigation, and a dialog
        // still holding an href would flash back if it does not.
        setPendingHref(null)
        if (href !== null) router.push(href)
      }}
    />
  )
}
