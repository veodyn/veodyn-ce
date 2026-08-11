// The CSS contract for the heatmap grid's scrollport and its sticky header
// bands. Split out of heatmap-renderer.tsx, which the file-size hook flagged
// once these rules carried the reasoning that makes them non-obvious. The seam
// is real: nothing here reads the model, and nothing left in the renderer
// decides layout mechanics.

// A sticky box is offset against its NEAREST scrollport and never consults an
// outer one. The heatmap's grid wrapper is a scroll container (`overflow-auto`,
// i.e. both axes explicitly), so it IS that nearest scrollport; when nothing
// bounds its height it grows to content, never scrolls vertically, and
// `top: 0` on a column header has nothing to do while the page carries the
// whole thing away. Measured in Chromium against a probe of that shape: a 400px
// page scroll moved the column header and the cell it labels by 400px each.
//
// So the wrapper is bounded TWICE, because this component renders inside seven
// different host boxes and they do not agree on whether they impose a height.
//
// GRID_HOST_BOUND binds where the HOST gives the renderer a definite height
// (the dashboard widget, the wall slide). `height: 100%` against an indefinite
// ancestor computes to auto rather than erroring, so the chain silently does
// nothing in the other hosts, which is what makes it safe to apply everywhere.
// It also reconciles the dashboard widget's own `overflow-auto` with this one:
// the renderer's root fills the widget exactly, so the widget never overflows
// and only one element scrolls. Measured in both host shapes, not assumed.
//
// Just `flex-1`, and deliberately WITHOUT the `min-h-0` it used to carry.
// Removing a flex item's automatic minimum size is load-bearing (without it the
// scroller refuses to shrink below the whole grid however short the host is,
// and the host ends up scrolling), but on this element GRID_MIN_HEIGHT does
// that job: an explicit min-height overrides the automatic minimum just as well.
// Carrying `min-h-0` here as well was documentation of a contract the element
// never received, since both are the same tailwind-merge group and the later
// class wins. The chain's own `min-h-0`s, on the root and the two wrappers
// between it and this element, are still required and are written there.
export const GRID_HOST_BOUND = 'flex-1'

// A CAP, applied unconditionally, not a fallback. Saying so plainly because an
// earlier version of this comment claimed otherwise and the code never did it.
//
// It is what bounds the grid in a host whose height is indefinite (the query
// editor, the report block, the embed page), where GRID_HOST_BOUND resolves to
// nothing. That is precisely why a naive `max-h-full` on its own cannot work: a
// percentage max-height against an indefinite ancestor height computes to
// `none`. But because it is applied alongside the host bound rather than behind
// it, it ALSO caps a host that is definite and taller than 70vh: on a 1080px
// `/present` slide the grid stops at 756px and leaves the rest as dead space
// above the legend. Nothing truncates and sticky still works, so this is
// cosmetic.
//
// A genuine fallback was attempted and measured, not merely reasoned about:
// `max-height: max(100%, 70vh)` gives the right answer in a definite host (a
// 1000px host yields 921px of scroller instead of 560px) but the wrong one in
// an indefinite host, where the percentage does not degrade to `none` inside
// `max()` and the cap silently stops binding (measured 723px where 70vh would
// have been 560px). A bound that quietly stops applying in the hosts it exists
// for is worse than one that over-applies in a host it does not, so the cap
// stands and this comment describes it accurately instead.
//
// max-height, not height, in both bounds: a grid shorter than either still
// sizes to its content and shows no scrollbar.
export const GRID_VIEWPORT_BOUND = 'max-h-[70vh]'

// The floor, and the reason the host bound cannot be applied on its own.
//
// `min-h-0` deliberately removes the scroller's automatic minimum size, which
// is what lets it shrink to whatever the host gives it. In a SMALL host that is
// a trap: `minH: 2` at `dashboard/dashboard-grid.tsx` with `rowHeight={50}`
// makes the smallest widget a user can drag to about 110px, leaving roughly
// 70px of body once the widget's own header row is out. The renderer spends
// `p-4` (32px), the x-axis title (~17px) and the legend (~28px) from that, so
// `flex-1` on the scroller resolves to almost nothing: measured at 28px against
// a 105px host, an invisible strip where the grid should be.
//
// The floor stops that, and its second effect is the important one: once the
// scroller refuses to shrink below the floor, the renderer's root no longer
// fits the host, so the HOST's own overflow takes over and the content stays
// reachable by scrolling. A short host therefore degrades to the two-scroller
// behaviour that predates this work rather than to no content at all. Measured:
// a 105px host gives a 128px scroller and a host that scrolls.
export const GRID_MIN_HEIGHT = 'min-h-[8rem]'

// The axis titles' own cap. Deliberately NOT GRID_VIEWPORT_BOUND, which it used
// to borrow: the two are unrelated concerns, and sharing one constant meant
// retuning the grid's height silently retuned how soon a long axis title
// truncated.
//
// It matters most for the y title, which is rotated into vertical writing mode,
// where the INLINE axis is vertical: an unbounded long column name runs the full
// height of the rotated text, stretches the axes row to match, and in a short
// widget pushes the renderer's root past the host and re-introduces the second
// scrollbar the host bound exists to remove.
//
// ONE constant, not a host/viewport pair like the grid's. An earlier version
// paired this with an exported `max-h-full`, borrowing the grid's shape, and
// that shape does not transfer: the grid's host bound is `flex-1`, which
// COMPOSES with a max-height, whereas two max-height classes on one element are
// the same tailwind-merge group and the later one simply deletes the earlier.
// The `max-h-full` never reached the DOM at all. What bounds the title against
// its host is `min-h-0` plus `overflow-hidden` on its wrapper, which is where
// that job belongs anyway, since the wrapper is what would otherwise grow.
//
// NOTE, so nothing here reads as a guarantee it is not: the vertical clipping
// this describes has no test. Producing it needs a y column NAME long enough to
// out-measure the axes row, and the longest friendly_name in the entire mock
// pack is 15 characters (about 90px of rotated text against roughly 251px of
// row). Rather than manufacture a fixture no query in this product can return,
// the guard is recorded as untested.
export const AXIS_TITLE_VIEWPORT_BOUND = 'max-h-[50vh]'

// Sticky header cells need an opaque background, or the cells scrolling
// underneath show straight through them. bg-card is the surface the
// visualization already sits on, so a stuck header reads as part of the frame
// rather than as a floating band.
//
// The stacking order is load-bearing and not arbitrary: a focused or active
// cell carries z-10 of its own (heatmap-cell.tsx), so both header bands have to
// outrank that, and the corner cell has to outrank both bands because it is the
// one element stuck on both axes at once and therefore the only one that can
// end up over another header.
//
// Sticky lives on these CELLS and not on the row wrappers because those are
// `display: contents`, which generates no box at all for sticky to offset.
export const STICKY_ROW_HEADER = 'sticky left-0 z-20 bg-card'
export const STICKY_COLUMN_HEADER = 'sticky top-0 z-30 bg-card'
export const STICKY_CORNER = 'sticky left-0 top-0 z-40 bg-card'

// The row-header column's floor, in rem.
//
// The track was a bare `auto`, whose MINIMUM is the item's min-content
// contribution, and `truncate` (overflow: hidden) makes that zero. On any grid
// wide enough to over-constrain the container the track therefore collapsed to
// its padding: measured at exactly 8px on the 30-column fixture, which is
// `pr-2` and a zero-width content box, with "Line 1" clipped away entirely.
// That predates the sticky work, but it is the exact grid a sticky row header
// exists for, and sticking an unreadable sliver in place is not the feature.
//
// 4rem is 64px, less `pr-2` leaves 56px of content box. Derived from the actual
// rendered width of this app's own y labels at `text-xs` (12px), measured in
// Chromium rather than estimated:
//
//   "A"                    8.03px      "Major"        31.38px
//   "Line 1"              30.53px      "Morning"      45.09px
//   "2026-02-20"          70.41px      "2026-03-18T00:00:00"  128.28px
//
// So 56px fits every non-date label this app's fixtures produce, with the
// widest ("Morning") clearing it by 11px. A date or a datetime still truncates
// on an over-constrained grid, exactly as it did before; the title attribute
// carries the full text either way.
//
// The honest cost, which this floor's own e2e test pins rather than leaving
// implied: it is a floor, NOT a fit. A heatmap whose y labels are all a
// character or two reserves the whole 64px gutter instead of shrinking to them,
// so the claim "a narrow grid still sizes the column to its longest label" is
// only true above the floor. Sizing to content below it is not available while
// the label truncates, because `overflow: hidden` is precisely what zeroes the
// min-content contribution that a bare `auto` track would have used.
export const ROW_HEADER_MIN_WIDTH = '4rem'

// The row-header cell: the gutter's ceiling, and the reason its labels wrap.
//
// The track's max is `auto`, so it sizes to the widest label in the column,
// and one long name therefore decided the whole grid's geometry: a station
// heatmap with names like "Downtown Interchange E Line Station (North)" spent
// 265px of gutter on a single row, and the label, right-aligned with padding on
// the right only, ran flush into the left edge of the card.
//
// The cap belongs on the CELL and not on the track. A `minmax(4rem, 12rem)`
// track has two fixed ends, so it is no longer content-sized at all: it sits at
// its 4rem base while the 1fr cell columns take the free space, and every label
// past 56px is clipped. Measured, not reasoned about. A max-width on the cell
// instead bounds the max-content contribution the `auto` max sizes from, so the
// track still fits short labels and stops growing at 12rem.
//
// max-w-48 is 192px; less the 8px of padding on each side, 176px of content
// box. Padding on BOTH sides, since right-aligned text with `pr-2` alone
// started at x=0 of the card.
export const ROW_HEADER_CELL = 'max-w-48 px-2 py-1 text-right text-xs'

// The label INSIDE that cell, bounded to two lines by a height rather than by
// `line-clamp-2`.
//
// The clamp was tried first and does not survive here: it needs
// `display: -webkit-box`, and Chromium reported `flow-root` for both the cell
// (a grid item, so blockified) and a span inside it, with `-webkit-line-clamp:
// 2` computed and doing nothing. A 44-character station name still grew its row
// to 19 lines and 308px. Measured, not assumed, which is the only reason this
// is written as a max-height instead.
//
// max-h-8 is 2rem, exactly two lines of `text-xs` (1rem line-height), and the
// overflow hides the rest. Two lines and not one: a third would grow the row
// past the cells it labels. The renderer keeps the `title` attribute, so the
// full name is always reachable, and `[overflow-wrap:anywhere]` is what lets a
// long single word wrap at all instead of running out of the box.
export const ROW_HEADER_LABEL = 'block max-h-8 overflow-hidden [overflow-wrap:anywhere]'

// The grid's column tracks: the row-header gutter, then one track per x
// category. The per-column `minmax(2.5rem, 1fr)` is unchanged from before this
// work: it shares out spare width when the grid fits and holds a 40px floor
// when it does not, which is what makes the grid overflow horizontally rather
// than crushing its cells.
export function heatmapGridColumns(xCategoryCount: number): string {
  return `minmax(${ROW_HEADER_MIN_WIDTH}, auto) repeat(${xCategoryCount}, minmax(2.5rem, 1fr))`
}
