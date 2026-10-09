'use client'

import { useCallback, useRef } from 'react'
import { pollIntervalMs, type PublicVisualizationResult } from './public-request'

interface PollQuery {
  queryHash: string
  state: { data: PublicVisualizationResult | null | undefined; dataUpdateCount: number }
}

interface Streak {
  queryHash: string
  updates: number
  count: number
}

export function usePublicPollInterval(refreshMs: number | null): (query: PollQuery) => number | false {
  const streak = useRef<Streak>({ queryHash: '', updates: 0, count: 0 })
  return useCallback(
    (query) => {
      const { data, dataUpdateCount } = query.state
      if (streak.current.queryHash !== query.queryHash) {
        streak.current = { queryHash: query.queryHash, updates: 0, count: 0 }
      }
      const current = streak.current
      if (current.updates !== dataUpdateCount) {
        current.updates = dataUpdateCount
        const waiting = data?.status === 'pending' || data?.status === 'unavailable'
        current.count = waiting ? current.count + 1 : 0
      }
      return pollIntervalMs(data, current.count, refreshMs)
    },
    [refreshMs]
  )
}
