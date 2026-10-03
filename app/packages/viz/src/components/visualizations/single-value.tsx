'use client'

import type { ReactNode } from 'react'

interface SingleValueProps {
  /** The number itself. The one thing this box must never crop. */
  value: ReactNode
  /** Caption under the value: a counter's label, or a table's column name. */
  label?: ReactNode
  /** Optional middle line, e.g. a counter's comparison against its target. */
  trend?: ReactNode
}

/**
 * One number, as large as its box allows, centred. Shared by the counter
 * visualization and by a TABLE whose result is a single numeric cell.
 *
 * h-full + overflow-hidden rather than padding: a fixed py-12 plus text-5xl came
 * to roughly 172px, taller than a one-row widget, so the box grew a scrollbar.
 *
 * [container-type:size] makes the cq units below resolve against this box, so
 * the value tracks the widget rather than a hardcoded size.
 *
 * aspect-ratio covers the parents with no definite height (a report block's bare
 * <figure>, the embed route's `min-h-screen` div): `h-full` computes to `auto`
 * there, and size containment stops the box growing to fit its children, so it
 * collapsed to 24px around a 30px number and cropped the digits. A min-height
 * cannot substitute, because the smallest dashboard tile is minH 2 at rowHeight
 * 50 (~60px of content area) and any floor tall enough would bring the scrollbar
 * back; edit-visualization-dialog.tsx records the same conclusion. aspect-ratio
 * yields because it applies only while the height is auto: inert under a
 * definite-height parent (measured at a 60px and a 200px tile), and in the 720px
 * report column it lands the box at 180px.
 *
 * The ratio alone left a residual, since the number is sized from the height it
 * was just given: below about 600px of width the trend row and the label did not
 * fit, and no ratio up to 5/2 cleared 280px. The @container rules below close it
 * from the other end, dropping the trend row under 7rem of height and the label
 * under 4.5rem.
 */
export function SingleValue({ value, label, trend }: SingleValueProps) {
  return (
    <div className="flex aspect-[4/1] h-full w-full flex-col items-center justify-center overflow-hidden p-3 text-center [container-type:size]">
      <div className="text-[clamp(1.5rem,min(9cqw,30cqh),3.5rem)] font-bold leading-tight text-foreground tabular-nums">
        {value}
      </div>
      {trend && <div className="text-lg mt-2 [@container_(max-height:7rem)]:hidden">{trend}</div>}
      {label && (
        <div className="text-sm text-muted-foreground mt-2 [@container_(max-height:4.5rem)]:hidden">
          {label}
        </div>
      )}
    </div>
  )
}
