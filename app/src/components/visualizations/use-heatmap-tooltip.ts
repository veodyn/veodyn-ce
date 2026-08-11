'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { cellKey } from './heatmap-cell-key'

// Extracted from use-heatmap-grid-interaction.ts, which the file-size hook
// flagged once the grid hook carried the roving-tabindex state, the colour
// memos, the hover/focus state machine AND the whole floating-tooltip
// lifecycle. The seam is real: nothing in here reads or writes the roving
// position, and nothing left in the grid hook measures a rect.

export interface TooltipPosition {
  top: number
  left: number
  placement: 'above' | 'below'
}

// The cell rect an open tooltip is anchored to, in viewport coordinates.
export interface TooltipAnchor {
  top: number
  bottom: number
  left: number
  width: number
}

// Space between the cell's edge and the tooltip's nearest edge.
const TOOLTIP_GAP = 8
// Half the tooltip's maximum on-screen width, used to clamp its horizontal
// anchor so a leftmost- or rightmost-column cell's tooltip cannot be asked to
// center itself partly off the edge of the viewport. The renderer caps the
// tooltip's own max-width at twice this, so the clamp holds for a long
// category label too, not only for a short one.
export const TOOLTIP_HALF_WIDTH = 100
// Height assumed for the very first tooltip of a session, before one has ever
// been measured. Only ever an opening guess: measureTooltip below replaces it
// with the real height in the same commit, before paint, and corrects the
// placement it produced if the guess was wrong. A constant used as the FINAL
// answer is what made the previous vertical-clearance bug: a single-line
// tooltip is 38px, so 48px of assumed clearance was right until removing
// whitespace-nowrap let a long label wrap to two lines and about 58px.
const TOOLTIP_ASSUMED_HEIGHT = 38
// A scroll counts as having moved the anchored cell only past this many CSS
// pixels. Fractional layout and sub-pixel scroll offsets make exact rect
// equality unreliable, and half a pixel of drift is not a stale tooltip. It
// has to stay well under a one-cell scroll, which is the smallest scroll a
// user can plausibly mean; the e2e suite pins that with a deliberately small
// real scroll rather than a large one.
const ANCHOR_EPSILON = 0.5
// How far measureTooltip will re-baseline the anchor against a fresh
// measurement. Activating a cell also bolds its row and column headers, which
// resizes the grid's `auto` first column and moves every cell by about a
// pixel (measured at 0.75 vertical, 1.17 horizontal), and that reflow lands
// after positionTooltip has already read the cell's rect inside the event
// handler. Anything larger is not a reflow, so it is treated as the cell
// genuinely moving and closes the tooltip rather than being absorbed
// silently, which would hide the move from the scroll listener as well.
const ANCHOR_REBASE_LIMIT = 4

// Pure, and exported so the placement rule can be asserted as plain
// input/output rather than only through a browser. 'above' renders with
// translateY(-100%), so its visual top is `top - height`: the tooltip fits
// above only when the cell has at least its own height of room there. The old
// rule compared the cell's top against a single constant, which silently
// encoded one specific tooltip height.
export function computeTooltipPosition(
  anchor: TooltipAnchor,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): TooltipPosition {
  const roomAbove = anchor.top - TOOLTIP_GAP
  const roomBelow = viewportHeight - anchor.bottom - TOOLTIP_GAP
  const placement: TooltipPosition['placement'] =
    roomAbove >= height ? 'above'
    : roomBelow >= height ? 'below'
      // Neither side fits, which needs a tooltip taller than the room on both
      // sides of the cell. Take the roomier side so what does get clipped is
      // as little as possible.
    : roomAbove > roomBelow ? 'above'
    : 'below'
  const top = placement === 'above' ? anchor.top - TOOLTIP_GAP : anchor.bottom + TOOLTIP_GAP
  const rawLeft = anchor.left + anchor.width / 2
  const left = Math.min(Math.max(rawLeft, TOOLTIP_HALF_WIDTH), viewportWidth - TOOLTIP_HALF_WIDTH)
  return { top, left, placement }
}

function samePosition(a: TooltipPosition, b: TooltipPosition): boolean {
  return a.placement === b.placement && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
}

function anchorOf(node: HTMLDivElement): TooltipAnchor {
  const rect = node.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width }
}

export function useHeatmapTooltip(
  activeCell: { x: string; y: string } | null,
  cellRefs: RefObject<Map<string, HTMLDivElement>>
) {
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null)
  const anchorRef = useRef<TooltipAnchor | null>(null)
  const heightRef = useRef(TOOLTIP_ASSUMED_HEIGHT)

  // Measures the cell's real, painted rect at the moment it activates (not in
  // a useEffect after the fact): the grid's own scroll wrapper is
  // `overflow-auto`, and a tooltip absolutely positioned inside a clipped
  // ancestor can be cut off with no CSS escape short of a portal. By the time
  // onMouseEnter/onFocus fires the cell's node is already mounted, so the
  // measurement can happen right here, with no effect-plus-setState round trip.
  const positionTooltip = useCallback(
    (x: string, y: string) => {
      const node = cellRefs.current.get(cellKey(x, y))
      if (!node) {
        anchorRef.current = null
        setTooltipPosition(null)
        return
      }
      const anchor = anchorOf(node)
      anchorRef.current = anchor
      setTooltipPosition(computeTooltipPosition(anchor, heightRef.current, window.innerWidth, window.innerHeight))
    },
    [cellRefs]
  )

  // A ref callback on the tooltip element, deliberately not an effect: this
  // project's react-hooks/set-state-in-effect rule is an error and rejects a
  // setState in an effect body even when guarded and even in useLayoutEffect
  // (verified directly against the config). A ref callback runs in the same
  // commit phase, before paint, so a correction made here never flickers. The
  // renderer passes it inline, so it runs on every render of the tooltip
  // rather than only on mount, which is what lets it see a reflow at all.
  //
  // Two jobs, both of which need the post-commit DOM that positionTooltip
  // (running inside the event handler, before React re-renders) cannot see:
  // measure the tooltip's real height and re-place it if the assumed height
  // put it somewhere it does not fit, and re-baseline the anchor against the
  // reflow that activating a cell causes.
  const measureTooltip = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      const height = node.getBoundingClientRect().height
      if (height > 0) heightRef.current = height
      const anchor = anchorRef.current
      const cellNode = activeCell ? cellRefs.current.get(cellKey(activeCell.x, activeCell.y)) : null
      if (!anchor || !cellNode) return
      const current = anchorOf(cellNode)
      const drift = Math.max(Math.abs(current.top - anchor.top), Math.abs(current.left - anchor.left))
      if (drift > ANCHOR_REBASE_LIMIT) {
        setTooltipPosition(null)
        return
      }
      anchorRef.current = current
      const placed = computeTooltipPosition(current, heightRef.current, window.innerWidth, window.innerHeight)
      // Returning prev unchanged is what stops this from looping: once the
      // placement is correct for the measured height, the next commit
      // computes the same answer and React bails out.
      setTooltipPosition((prev) => (prev == null || samePosition(prev, placed) ? prev : placed))
    },
    [activeCell, cellRefs]
  )

  // Closes the tooltip when a scroll (of the grid's own overflow-auto
  // wrapper, of any other scrollable ancestor, or of the page) has actually
  // moved the cell it is anchored to. Without this the tooltip stayed pinned
  // at its original viewport coordinates while the cell it names slid out
  // from under it (a scrolled cell fires no mouseleave, so hover-based
  // deactivation never catches this).
  //
  // Comparing the cell's live rect against the anchor, rather than treating
  // every scroll event as a dismissal, is what removes the race with the
  // grid's own scrollIntoView: that path re-anchors before its scroll event
  // is delivered, so the check simply finds a cell that has not moved. A flag
  // suppressing "the next scroll" cannot do this correctly, because nothing
  // guarantees a next scroll ever arrives (an already-visible cell scrolls
  // nothing at all, which is the common case), and a flag left armed swallows
  // the user's next genuine scroll instead. The comparison is sound because
  // the tooltip is position: fixed and portaled to document.body with no
  // fixed-position containing block above it, so "the cell's viewport rect
  // moved" and "the tooltip is stale" are the same proposition.
  //
  // Neither branch clears the caller's activeCell, which drives the focus
  // ring: that ring is plain CSS on the cell's own box, so it moves with the
  // cell under both a scroll and a reflow, and clearing it left a focused
  // cell with no visible focus indicator (WCAG 2.4.7) with no focus change to
  // justify it.
  //
  // capture: true so a scroll on a nested scroller (scroll events do not
  // bubble) is caught here too, not only a window-level scroll. resize closes
  // outright rather than re-anchoring: a reflow can change the cell's size and
  // the tooltip's own wrapped height together, which is more than a
  // repositioned anchor describes.
  useEffect(() => {
    if (!activeCell) return
    const closeTooltip = () => setTooltipPosition(null)
    const closeIfAnchorMoved = () => {
      const anchor = anchorRef.current
      const node = cellRefs.current.get(cellKey(activeCell.x, activeCell.y))
      if (!anchor || !node) {
        closeTooltip()
        return
      }
      const rect = node.getBoundingClientRect()
      const moved =
        Math.abs(rect.top - anchor.top) >= ANCHOR_EPSILON || Math.abs(rect.left - anchor.left) >= ANCHOR_EPSILON
      if (moved) closeTooltip()
    }
    window.addEventListener('scroll', closeIfAnchorMoved, true)
    window.addEventListener('resize', closeTooltip)
    return () => {
      window.removeEventListener('scroll', closeIfAnchorMoved, true)
      window.removeEventListener('resize', closeTooltip)
    }
  }, [activeCell, cellRefs])

  return { tooltipPosition, positionTooltip, measureTooltip }
}
