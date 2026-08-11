'use client'

import { Suspense } from 'react'
import { getVisualization } from '@/lib/visualizations'
import type { QueryResultData } from '@/lib/mock-data'

interface VisualizationEditorSlotProps {
  type: string
  options: Record<string, unknown>
  data: QueryResultData
  onChange: (options: Record<string, unknown>) => void
}

/**
 * The registered editor for a type, or the reason there is none.
 *
 * Its own component rather than a closure inside the edit dialog because
 * editors are loaded on demand (see lib/visualizations/lazy-components.ts) and
 * so need a Suspense boundary, and a boundary is a thing with a lifetime: it
 * has to be keyed by type, and reading that key next to the fallback it guards
 * is what makes the keying legible. The dialog is also at the size the
 * file-size hook enforces, and this is the piece with exactly one caller.
 */
export function VisualizationEditorSlot({
  type,
  options,
  data,
  onChange,
}: VisualizationEditorSlotProps) {
  const Editor = getVisualization(type)?.Editor

  if (!Editor) {
    return <div className="text-sm text-muted-foreground">No editor for this type.</div>
  }

  return (
    // Keyed by type so switching type discards the resolved boundary rather
    // than leaving the previous type's controls on screen while the next
    // type's chunk arrives.
    <Suspense
      key={type}
      // Decorative for the same reason the renderer's is: the dialog names
      // itself and the type, what is awaited is a script chunk, and a status
      // region here would compete with the problems list beside the preview.
      fallback={
        <div
          aria-hidden="true"
          className="h-40 w-full rounded-md bg-muted motion-safe:animate-pulse"
        />
      }
    >
      <Editor options={options} columns={data.columns} data={data} onChange={onChange} />
    </Suspense>
  )
}
