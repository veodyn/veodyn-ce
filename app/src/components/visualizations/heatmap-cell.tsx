'use client'

import { memo, type KeyboardEvent } from 'react'
import { formatCompactNumber } from '@/lib/chart-format'
import { cn } from '@/lib/utils'

export interface HeatmapCellProps {
  x: string
  y: string
  xi: number
  yi: number
  value: number | undefined
  showValues: boolean
  backgroundColor: string
  color: string | undefined
  isRowActive: boolean
  isColActive: boolean
  isActiveCell: boolean
  isFocused: boolean
  tabIndex: 0 | -1
  description: string
  onActivate: (x: string, y: string) => void
  onDeactivate: (x: string, y: string) => void
  onFocusCell: (x: string, y: string) => void
  onBlurCell: (x: string, y: string) => void
  onNavigate: (e: KeyboardEvent<HTMLDivElement>, xi: number, yi: number) => void
  registerRef: (x: string, y: string, node: HTMLDivElement | null) => void
}

// Split out of heatmap-renderer.tsx and memoized so hovering or focusing a
// cell only re-renders the handful of cells whose row, column, or active
// state actually changed, not the whole grid. On a dense grid (the 150-cell
// density threshold implies grids well past that) a full re-render per
// pointer transition, on top of the getComputedStyle color-mixing this file
// already flags as expensive, is the perf bug this split exists to avoid.
// Every prop here has to stay value- or reference-stable across an unrelated
// re-render for the memoization to do anything; see the useMemo/useCallback
// wiring in use-heatmap-grid-interaction.ts that keeps colorFor/inkFor and
// every handler passed down here stable.
export const HeatmapCell = memo(function HeatmapCell({
  x,
  y,
  xi,
  yi,
  value,
  showValues,
  backgroundColor,
  color,
  isRowActive,
  isColActive,
  isActiveCell,
  isFocused,
  tabIndex,
  description,
  onActivate,
  onDeactivate,
  onFocusCell,
  onBlurCell,
  onNavigate,
  registerRef,
}: HeatmapCellProps) {
  return (
    <div
      ref={(node) => registerRef(x, y, node)}
      role="gridcell"
      tabIndex={tabIndex}
      aria-label={description}
      className={cn(
        // focus-visible:, not a bare forced-colors:outline: unconditional on
        // every cell, the outline could not tell a reader which cell was
        // actually focused (every one of a dense grid's cells would carry
        // the same permanent outline), which is the exact defect this rule
        // exists to close.
        'relative aspect-square min-h-8 rounded-sm flex items-center justify-center text-[10px] font-medium tabular-nums outline-none forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2',
        (isRowActive || isColActive) && 'ring-1 ring-ring/60',
        // isFocused, separately from isActiveCell: the focused cell keeps its
        // ring while the pointer is over some other cell, or has just left
        // one. Tying the ring to the hover-or-focus state alone let ordinary
        // pointer activity take the only visible focus indicator off a cell
        // that still held DOM focus.
        (isActiveCell || isFocused) && 'ring-2 ring-ring z-10'
      )}
      style={{ backgroundColor, color }}
      onMouseEnter={() => onActivate(x, y)}
      onMouseLeave={() => onDeactivate(x, y)}
      onFocus={() => onFocusCell(x, y)}
      onBlur={() => onBlurCell(x, y)}
      onKeyDown={(e) => onNavigate(e, xi, yi)}
    >
      {value != null && showValues ? formatCompactNumber(value) : ''}
    </div>
  )
})
