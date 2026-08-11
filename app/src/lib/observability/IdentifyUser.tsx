'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { identifyUser, resetIdentity } from './capture'

/**
 * Attaches the PostHog person once a session exists, and renders nothing.
 *
 * distinct_id is the Redash user id as a string. veodyn-api uses the same id for
 * its server-side captures, so client and server events land on one person
 * timeline without passing anything in a header.
 *
 * Reads the store directly rather than taking a prop: the root layout is a
 * server component with no session, so there is nothing to thread down from.
 */
export function IdentifyUser(): null {
  const id = useAuthStore((s) => s.currentUser?.id ?? null)
  const name = useAuthStore((s) => s.currentUser?.name ?? '')
  const email = useAuthStore((s) => s.currentUser?.email ?? '')

  useEffect(() => {
    if (id === null) {
      resetIdentity()
      return
    }
    identifyUser({ id: String(id), name, email })
  }, [id, name, email])

  return null
}
