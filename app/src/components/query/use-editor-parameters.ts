'use client'

import { useCallback, useMemo, useState } from 'react'
import type { MockQuery, MockQueryParameter } from '@/lib/mock-data'
import { detectParameterNames, syncParameters } from '@/lib/parameters/detect'
import { resolveParameterValues } from '@/lib/parameters/dynamic-dates'

/**
 * The parameters an editor buffer declares, and the values to run it with.
 *
 * Authoring is by writing `{{ name }}` in the SQL, so the definition list is
 * derived from the buffer on every change rather than edited directly. Settings
 * made in the dialog are held here as overrides and survive further edits to the
 * SQL, because syncParameters keeps any definition whose name is still
 * referenced.
 *
 * Values matter as much as definitions in the editor: the ad hoc endpoint still
 * refuses a run with a parameter missing (`missing_params` applies no
 * defaults), so a buffer containing `{{ x }}` cannot execute at all until
 * something supplies x.
 */
export function useEditorParameters(
  queryText: string,
  // Null as well as undefined: useQueryById resolves to null for a query that
  // is not there, which is the shape a new (unsaved) editor is in.
  existingQuery: MockQuery | null | undefined,
  /**
   * Marks the editor buffer unsaved. Configuring a parameter changes what a
   * save would write, but it does not touch the SQL, and Save is disabled while
   * the buffer is clean: without this the settings dialog would accept an edit
   * that nothing could then persist.
   */
  setIsDirty: (dirty: boolean) => void
) {
  // Definitions edited in the settings dialog, keyed by parameter name. Kept
  // apart from the saved query so an edit is not lost every time the SQL
  // changes, and so the callbacks below do not have to write through to it.
  const [overrides, setOverrides] = useState<Record<string, MockQueryParameter>>({})
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState<MockQueryParameter | null>(null)

  const parameters = useMemo(() => {
    const saved = existingQuery?.options?.parameters ?? []
    const base = syncParameters(saved, detectParameterNames(queryText))
    return base.map((p) => overrides[p.name] ?? p)
  }, [queryText, existingQuery, overrides])

  // The values to send for a run: whatever has been set, falling back to each
  // parameter's own default, with dynamic dates resolved at the moment of the
  // run rather than when they were picked.
  const executionValues = useCallback((): Record<string, unknown> => {
    const merged: Record<string, unknown> = {}
    for (const p of parameters) {
      merged[p.name] = p.name in values ? values[p.name] : p.value
    }
    return resolveParameterValues(parameters, merged, new Date())
  }, [parameters, values])

  const openSettings = useCallback((parameter: MockQueryParameter) => setEditing(parameter), [])
  const closeSettings = useCallback(() => setEditing(null), [])

  const saveSettings = useCallback(
    (parameter: MockQueryParameter) => {
      setOverrides((prev) => ({ ...prev, [parameter.name]: parameter }))
      setIsDirty(true)
    },
    [setIsDirty]
  )

  // Callbacks rather than the raw setter, so the component does not have to
  // re-derive how a value edit and an applied set relate to each other.
  const applyValues = useCallback((next: Record<string, unknown>) => setValues(next), [])

  return {
    parameters,
    executionValues,
    applyValues,
    editing,
    openSettings,
    closeSettings,
    saveSettings,
  }
}
