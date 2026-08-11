'use client'

// What the query editor holds and whether it is unsaved: the SQL buffer, the
// data source it is aimed at, and the dirty flag both authoring modes set.
// Extracted from query-editor-page for the same reason useVisualMode was, so
// the page stays a layout rather than also being the place that decides when a
// loading query is allowed to overwrite what the analyst has typed.
import { useCallback, useEffect, useState } from 'react'
import { appendSqlToken } from '@/lib/sql-insert'

// Structural, not the full query/data-source types: this hook only ever reads
// these three fields, and taking them structurally keeps it independent of
// whether the mock store or the real service answered.
interface SeedableQuery {
  id: number
  query: string
  data_source_id: number
}

interface SelectableSource {
  id: number
  syntax?: string | null
}

export function useQueryBuffer(
  existingQuery: SeedableQuery | null | undefined,
  dataSources: SelectableSource[] | undefined
) {
  const [queryText, setQueryText] = useState(existingQuery?.query ?? '')
  // 0 means "no source resolved yet", the way `NO_QUERY` does elsewhere: Redash
  // ids start at 1, so it cannot collide with a real one. A new query used to
  // start at a literal `1`, which is an id, not a default. Whether that id can
  // run SQL at all depends on the order rows went into someone's database: on
  // the dev instance id 1 is a feed source that takes JSON, so every new query
  // aimed its SQL at a source that answers "Invalid query JSON".
  const [dataSourceId, setDataSourceId] = useState<number>(existingQuery?.data_source_id ?? 0)
  const [isDirty, setIsDirty] = useState(false)

  // The query loads async, seed the editor once when it arrives, without
  // clobbering anything the user already typed (render-time state adjustment).
  const [seededQueryId, setSeededQueryId] = useState<number | undefined>(undefined)
  if (existingQuery && seededQueryId !== existingQuery.id) {
    setSeededQueryId(existingQuery.id)
    if (!isDirty) {
      setQueryText(existingQuery.query)
      setDataSourceId(existingQuery.data_source_id)
    }
  }
  // The list loads async too, so the default is picked when it arrives rather
  // than guessed before. Both editor modes emit SQL and nothing else, so a
  // source that takes some other language is not somewhere a new query can
  // start; the first one that does take SQL is. Falling back to the first
  // source of any kind keeps the picker populated on an instance that has no
  // SQL source at all, where the Run button switches itself off anyway.
  if (dataSourceId === 0 && dataSources && dataSources.length > 0) {
    setDataSourceId((dataSources.find((source) => source.syntax === 'sql') ?? dataSources[0]).id)
  }

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // The two ways the buffer changes, both of which make it unsaved. They live
  // here rather than in the page because the raw setters no longer read as
  // stable once they come back through a hook, and every page-side callback
  // closing over them had to list them as dependencies to say so.
  // Writing back what the buffer already holds is not an edit. Visual mode's
  // handoffs republish the composed SQL on the way to PRO, so without this a
  // query that had just been saved arrived there marked unsaved again.
  const setQuery = useCallback(
    (value: string) => {
      if (value === queryText) return
      setQueryText(value)
      setIsDirty(true)
    },
    [queryText]
  )

  const appendQuery = useCallback((text: string) => {
    // Not `previous + text`. That is what put
    // `LIMIT 50historical.q_regional_demo_environment_current_weather_31` in the
    // buffer when a table was clicked with the caret after a complete
    // statement: valid-looking new text welded onto the old with no separator.
    setQueryText((previous) => appendSqlToken(previous, text))
    setIsDirty(true)
  }, [])

  return {
    queryText,
    /** Replaces the buffer and marks it unsaved. */
    setQuery,
    /** Appends to the buffer (the schema tree's one action) and marks it unsaved. */
    appendQuery,
    dataSourceId,
    setDataSourceId,
    isDirty,
    /** For the one caller that clears it: a save that succeeded. */
    setIsDirty,
  }
}
