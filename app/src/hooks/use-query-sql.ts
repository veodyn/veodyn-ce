'use client'

import { useMemo } from 'react'
import { useAllQueries } from '@/hooks/use-queries'

/**
 * Every saved query's SQL, by id.
 *
 * For tracing a KPI to the dataset it reads: the edge is the table name in the
 * KPI query's FROM clause, so resolving it needs the SQL. The list endpoint
 * already serializes `query` on every row, so this is one request shared
 * through react-query's cache by every KPI row on a page, rather than one
 * fetch per KPI.
 *
 * A query the list does not return (archived, or not listed for this user)
 * simply has no entry, and the callers fail closed on a miss.
 */
export function useQuerySqlById(): Map<number, string> {
  const { data } = useAllQueries()
  return useMemo(() => {
    const map = new Map<number, string>()
    for (const query of data?.results ?? []) {
      if (typeof query.query === 'string') map.set(query.id, query.query)
    }
    return map
  }, [data])
}
