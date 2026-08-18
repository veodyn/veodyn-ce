'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { cellKey } from './heatmap-cell-key'

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
// anchor so an edge-column cell's tooltip cannot center itself partly off the
// viewport. The renderer caps the tooltip's max-width at twice this.
export const TOOLTIP_HALF_WIDTH = 100
// Opening guess only, before any tooltip has been measured: measureTooltip
// replaces it with the real height in the same commit, before paint. A
// single-line tooltip measures 38px, a wrapped two-line one about 58px.
const TOOLTIP_ASSUMED_HEIGHT = 38
// A scroll counts as having moved the anchored cell only past this many CSS
// pixels: fractional layout and sub-pixel scroll offsets make exact rect
// equality unreliable. It has to stay well under a one-cell scroll.
const ANCHOR_EPSILON = 0.5
// How far measureTooltip will re-baseline the anchor, in CSS pixels.
// Activating a cell bolds its row and column headers, which resizes the grid's
// `auto` first column and moves every cell (measured at 0.75 vertical, 1.17
// horizontal) after positionTooltip has already read the rect. Anything larger
// is the cell genuinely moving, and closes the tooltip.
const ANCHOR_REBASE_LIMIT = 4

// Pure, and exported so the placement rule can be asserted as plain
// input/output rather than only through a browser. 'above' renders with
// translateY(-100%), so its visual top is `top - height`: it fits above only
// when the cell has at least the tooltip's own height of room there.
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

  // Measures the cell's painted rect at the moment it activates: the tooltip is
  // portaled, because the grid's scroll wrapper is `overflow-auto` and would
  // clip it. By the time onMouseEnter/onFocus fires the cell's node is mounted,
  // so this needs no effect-plus-setState round trip.
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

  // A ref callback, not an effect: react-hooks/set-state-in-effect is an error
  // here and rejects a setState in an effect body even in useLayoutEffect. A
  // ref callback runs in the same commit phase, before paint, so a correction
  // never flickers, and the renderer passes it inline so it runs on every
  // render of the tooltip rather than only on mount.
  //
  // Two jobs, both needing the post-commit DOM positionTooltip cannot see:
  // measure the real height and re-place if the assumed one did not fit, and
  // re-baseline the anchor against the reflow activating a cell causes.
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
      // Returning prev unchanged stops this looping: once the placement is
      // correct, the next commit computes the same answer and React bails out.
      setTooltipPosition((prev) => (prev == null || samePosition(prev, placed) ? prev : placed))
    },
    [activeCell, cellRefs]
  )

  // Closes the tooltip when a scroll has actually moved the cell it is
  // anchored to. A scrolled cell fires no mouseleave, so hover-based
  // deactivation never catches this.
  //
  // Comparing the cell's live rect against the anchor, rather than treating
  // every scroll as a dismissal, avoids racing the grid's own scrollIntoView,
  // which re-anchors before its scroll event is delivered. The comparison is
  // sound because the tooltip is position: fixed and portaled to document.body
  // with no fixed-position containing block above it.
  //
  // Neither branch clears activeCell: that drives the focus ring, which is
  // plain CSS on the cell's own box and moves with it, and clearing it would
  // leave a focused cell with no visible focus indicator (WCAG 2.4.7).
  //
  // capture: true because scroll events do not bubble, so a nested scroller
  // would otherwise go unseen. resize closes outright rather than re-anchoring:
  // it can change the cell's size and the tooltip's wrapped height together.
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
