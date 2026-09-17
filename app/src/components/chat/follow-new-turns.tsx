'use client'

import { useEffect, useRef } from 'react'
import { useMessageScroller } from '@/components/ui/message-scroller'

export function FollowNewTurns({ lastTurnId, loading }: { lastTurnId: string | null; loading: boolean }) {
  const { scrollToEnd } = useMessageScroller()
  const seen = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (loading) return
    if (seen.current !== undefined && lastTurnId !== null && lastTurnId !== seen.current) {
      scrollToEnd({ behavior: 'smooth' })
    }
    seen.current = lastTurnId
  }, [lastTurnId, loading, scrollToEnd])

  return null
}
