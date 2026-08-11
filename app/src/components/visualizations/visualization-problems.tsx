'use client'

import { TriangleAlert } from 'lucide-react'

interface VisualizationProblemsProps {
  problems: string[]
  className?: string
}

/**
 * Says why a visualization is about to draw nothing.
 *
 * Deliberately a note above the visualization rather than a replacement for
 * it. A chart whose y column vanished still draws correct axes, and hiding
 * that behind an error would throw away the half that is still true. The
 * previous behaviour was worse than either: it drew the axes and said nothing
 * at all, so the chart looked like a real answer of "no data".
 */
export function VisualizationProblems({ problems, className }: VisualizationProblemsProps) {
  if (problems.length === 0) return null

  return (
    <div
      role="status"
      className={`flex items-start gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground ${className ?? ''}`}
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
      <ul className="space-y-0.5">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  )
}
