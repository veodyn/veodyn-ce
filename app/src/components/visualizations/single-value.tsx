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
 * h-full + overflow-hidden, not padding: a fixed py-12 plus a fixed text-5xl
 * came to roughly 172px, which is taller than a one-row widget, so the box it
 * sits in grew a scrollbar around a number that would otherwise have fitted.
 *
 * [container-type:size] makes the cq units below resolve against this box, so
 * the value tracks the widget it is in rather than a hardcoded size. clamp()
 * keeps it readable in a small widget and stops it running away in a large
 * one.
 *
 * aspect-ratio is what makes that safe where the parent has NO definite
 * height, which is over half the call sites: a report block renders this in a
 * bare <figure>, and the embed route inside a `min-h-screen` div, both of
 * which are auto-height. `h-full` against an auto-height parent computes to
 * `auto`, and size containment means the box then does NOT grow to fit its
 * children, so it collapsed to 24px around a 30px number and overflow-hidden
 * cropped the digits: a counter in a report showed the bottom sliver of its
 * value and nothing else.
 *
 * A min-height cannot fix this. The smallest dashboard tile is minH 2 at
 * rowHeight 50, so roughly 60px of content area once the widget header is
 * taken off, and any floor tall enough to hold this content would push that
 * tile into the very scrollbar the box shape above exists to avoid.
 * edit-visualization-dialog.tsx reaches the same conclusion in its own words:
 * "a min-height that yields when there is no room is not expressible".
 *
 * aspect-ratio does yield, because it applies only while the height is auto.
 * Definite-height parent (dashboard tile, wall slide, editor preview):
 * `h-full` wins and this is inert, measured at both a 60px and a 200px tile.
 * Auto-height parent (report, embed): the height comes from the
 * always-definite width, so the box has a real size, cqh has something to
 * read, and nothing is clipped. The report column is 720px, which lands this
 * at 180px.
 *
 * The ratio alone still left a residual, because the number is sized from the
 * height it was just given, so a taller box means taller content and the two
 * chase each other: below about 600px of width the trend row and the label
 * did not fit. No ratio up to 5/2 cleared 280px.
 *
 * The @container rules below close it from the other end, by dropping the
 * supporting lines instead of growing the box. The box is itself the size
 * container, so its own children can query its height. Under 7rem the trend
 * row goes, under 4.5rem the label goes too, leaving the value. That also
 * fixes a case that predates any of this: the smallest dashboard tile is about
 * 60px of content area, and its label has always been clipped there.
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
