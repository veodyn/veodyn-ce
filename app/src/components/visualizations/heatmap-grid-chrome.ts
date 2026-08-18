// The CSS contract for the heatmap grid's scrollport and its sticky header bands.

// Binds where the host gives the renderer a definite height (dashboard widget,
// the `/present` wall slide). `height: 100%` against an indefinite ancestor
// computes to auto, so this is inert in the other hosts and safe everywhere.
export const GRID_HOST_BOUND = 'flex-1'

// A cap, applied unconditionally. It is what bounds the grid in an indefinite
// host (query editor, report block, embed page), where GRID_HOST_BOUND resolves
// to nothing. `max-h-full` cannot do this job: a percentage max-height against
// an indefinite ancestor computes to `none`.
export const GRID_VIEWPORT_BOUND = 'max-h-[70vh]'

// The scroller's floor. Without it a widget dragged to its `minH: 2` minimum
// (~110px) leaves the grid a 28px strip. Once the scroller refuses to shrink
// further the host's own overflow takes over, so a short host scrolls instead
// of hiding the grid.
export const GRID_MIN_HEIGHT = 'min-h-[8rem]'

// The axis titles' own cap, unrelated to the grid's. It matters for the rotated
// y title, whose inline axis is vertical: an unbounded long column name runs the
// full height of the rotated text and stretches the axes row. That clipping case
// has no test, because no fixture column name is long enough to produce it.
export const AXIS_TITLE_VIEWPORT_BOUND = 'max-h-[50vh]'

// Opaque backgrounds, or the cells scrolling underneath show through. The z
// order is load-bearing: a focused cell carries z-10 (heatmap-cell.tsx), so both
// bands outrank it, and the corner outranks both because it sticks on both axes.
// Sticky lives on the cells, not the row wrappers: those are `display: contents`
// and generate no box to offset.
export const STICKY_ROW_HEADER = 'sticky left-0 z-20 bg-card'
export const STICKY_COLUMN_HEADER = 'sticky top-0 z-30 bg-card'
export const STICKY_CORNER = 'sticky left-0 top-0 z-40 bg-card'

// The row-header column's floor, in rem. A bare `auto` track collapses to its
// padding on an over-constrained grid, because `truncate` zeroes the min-content
// contribution the track sizes from. 4rem less `pr-2` fits every non-date label
// at `text-xs`. It is a floor and not a fit: short labels still reserve the
// whole gutter.
export const ROW_HEADER_MIN_WIDTH = '4rem'

// The gutter's ceiling. The cap belongs on the cell, not the track: a
// `minmax(4rem, 12rem)` track has two fixed ends, so it stops being
// content-sized and clips every label past the base. A max-width on the cell
// bounds the max-content contribution the `auto` max sizes from instead.
export const ROW_HEADER_CELL = 'max-w-48 px-2 py-1 text-right text-xs'

// Two lines by max-height, not `line-clamp-2`: the clamp needs
// `display: -webkit-box`, and a grid item is blockified to `flow-root`, so it
// computes and does nothing. The renderer keeps the `title` attribute, and
// `[overflow-wrap:anywhere]` is what wraps a long single word.
export const ROW_HEADER_LABEL = 'block max-h-8 overflow-hidden [overflow-wrap:anywhere]'

// The row-header gutter, then one track per x category. `minmax(2.5rem, 1fr)`
// shares out spare width and holds a 40px floor, so the grid overflows
// horizontally rather than crushing its cells.
export function heatmapGridColumns(xCategoryCount: number): string {
  return `minmax(${ROW_HEADER_MIN_WIDTH}, auto) repeat(${xCategoryCount}, minmax(2.5rem, 1fr))`
}
