'use client'

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getSequentialInk, getSequentialScale } from '@/lib/chart-colors'
import { useThemeTokenVersion } from '@/hooks/use-theme-token-version'
import { cellKey } from './heatmap-cell-key'
import { useHeatmapTooltip } from './use-heatmap-tooltip'

// Split out of heatmap-renderer.tsx (which the file-size hook flagged once
// this state machine grew arrow-key navigation, roving tabIndex, and a
// scroll-aware tooltip): a real seam between the grid's interaction state
// and its JSX, not a forced split to dodge the limit. The tooltip's own
// lifecycle split off again, into use-heatmap-tooltip.ts, for the same reason.

// The cell a pointer or focus currently sits on. Both hover and focus drive
// the SAME state (rather than two separate hovered/focused states) because
// they mean the same thing for the tooltip and the row/column band: "read
// this cell", whichever input reached it. The FOCUS RING is deliberately not
// one of them; see focusedCell below. x/y (not a joined string key) so the
// row/column comparisons the caller makes never have to split a composite key
// back apart, which would be unsafe the moment a category value itself
// contains the join character.
export interface ActiveCell {
  x: string
  y: string
}

export interface RovingIndices {
  nextXi: number
  nextYi: number
}

// Pure and exported specifically so the boundary clamp can be asserted
// directly, as a plain input/output pair, rather than only through a DOM
// focus assertion. At the edge itself (xi/yi already 0, or already the last
// index) a WORKING clamp and a clamp that was accidentally dropped produce
// the exact same DOM-observable outcome: xCategories[-1] is undefined,
// focusCellAt's lookup finds no node and returns, and focus stays exactly
// where a correct clamp would also have left it. A DOM-level test pressing
// ArrowLeft at index 0 and asserting focus did not move cannot tell those two
// implementations apart; only a direct assertion on the returned index (0 vs
// -1) can.
export function nextRovingIndices(
  key: string,
  xi: number,
  yi: number,
  xLength: number,
  yLength: number
): RovingIndices | null {
  // An empty axis has no index to move to at all: the clamps below would hand
  // back -1 for ArrowRight (Math.min(xi + 1, -1)), naming a cell that cannot
  // exist. Null means "no move", the same answer a non-arrow key gets.
  if (xLength === 0 || yLength === 0) return null
  if (key === 'ArrowRight') return { nextXi: Math.min(xi + 1, xLength - 1), nextYi: yi }
  if (key === 'ArrowLeft') return { nextXi: Math.max(xi - 1, 0), nextYi: yi }
  if (key === 'ArrowDown') return { nextXi: xi, nextYi: Math.min(yi + 1, yLength - 1) }
  if (key === 'ArrowUp') return { nextXi: xi, nextYi: Math.max(yi - 1, 0) }
  return null
}

// xCategories/yCategories must be stable references across renders that do
// not change the underlying model (the caller memoizes them): handleNavigate
// below depends on them, and an unstable array would defeat the whole point
// of memoizing it.
export function useHeatmapGridInteraction(xCategories: string[], yCategories: string[], min: number, max: number) {
  // Hover OR focus, whichever last reached a cell: drives the tooltip and the
  // row/column band.
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  // activeCell and focusedCell are each mirrored into a ref, and every write
  // to either goes through the applier beside it, so a handler can read the
  // latest value of both without closing over the state and without listing
  // it as a dependency.
  //
  // That is load-bearing rather than tidy: HeatmapCell is memo()'d, and a
  // handler whose identity changes every render defeats the memo and
  // re-renders every cell in the grid on every pointer move. handleDeactivate
  // below has to consult BOTH pieces of state and still be stable, which a
  // dependency array cannot give it and a functional setState cannot either
  // (it can see one of the two, and only inside an updater, where a
  // positionTooltip call would be a side effect run twice under StrictMode).
  const activeCellRef = useRef<ActiveCell | null>(null)
  const applyActiveCell = useCallback((next: ActiveCell | null) => {
    activeCellRef.current = next
    setActiveCell(next)
  }, [])
  // Which cell holds DOM focus, tracked separately from activeCell and read
  // by the caller purely to paint the focus ring. Collapsing the two (the
  // shape this component shipped with) meant pointer activity anywhere in the
  // grid took the focus indicator off the focused cell: hovering another cell
  // stole activeCell, and leaving that cell cleared activeCell outright, with
  // no DOM focus change at all. It is reachable without the user moving the
  // mouse, because scrolling content under a stationary pointer makes
  // Chromium re-run its hit test and fire mouseover/mouseout, so ordinary
  // arrow-key navigation with the mouse resting over the grid flickered the
  // only visible focus indicator off and on (WCAG 2.4.7).
  const [focusedCell, setFocusedCell] = useState<ActiveCell | null>(null)
  const focusedCellRef = useRef<ActiveCell | null>(null)
  const applyFocusedCell = useCallback((next: ActiveCell | null) => {
    focusedCellRef.current = next
    setFocusedCell(next)
  }, [])
  // Roving tabindex (ARIA grid pattern): exactly one cell is ever a Tab stop.
  // Distinct from focusedCell because it deliberately SURVIVES blur, so
  // tabbing back into the grid returns to where focus left off rather than to
  // the first cell.
  const [rovingCell, setRovingCell] = useState<ActiveCell | null>(null)
  const cellRefs = useRef(new Map<string, HTMLDivElement>())
  const { tooltipPosition, positionTooltip, measureTooltip } = useHeatmapTooltip(activeCell, cellRefs)
  // Bumps whenever the active theme scope's class/data-theme attribute
  // changes. Read by neither colorFor nor inkFor below; it exists only so a
  // light/dark toggle invalidates inkFor's memoization (see the comment on
  // inkFor). See choropleth-renderer.tsx for the same pattern against the
  // same hazard.
  const themeVersion = useThemeTokenVersion()

  // getSequentialScale reads no CSS custom property at all: its returned
  // function closes over nothing but (min, max) and emits a live CSS
  // expression (`color-mix(in oklab, var(--card), var(--chart-1) N%)`),
  // which the BROWSER re-resolves against whichever theme is active every
  // time it repaints, regardless of when this factory last ran. Including
  // themeVersion here is a deliberately harmless no-op (it cannot make
  // colorFor's OUTPUT more correct, since that output already tracks the
  // theme live), kept only so this memo's dependency list matches inkFor's
  // immediately below, rather than reading as an inconsistency between two
  // otherwise-identical call sites.
  const colorFor = useMemo(
    () => getSequentialScale(min, max),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- themeVersion kept for symmetry with inkFor; harmless no-op here, see comment above
    [min, max, themeVersion]
  )
  // Unlike colorFor, getSequentialInk DOES resolve --card/--foreground/
  // --chart-1 via getComputedStyle, once, at factory-call time, to decide
  // which of 'var(--foreground)' / 'var(--card)' has better contrast against
  // the ramp colour, then bakes that CHOICE into the returned closure.
  // Whichever variable name it returns still paints live on a theme toggle,
  // but the CHOICE itself does not: it stays decided against the tokens
  // resolved under the OLD theme until this memo is invalidated. themeVersion
  // is exactly that invalidation signal.
  const inkFor = useMemo(
    () => getSequentialInk(min, max),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- themeVersion invalidates the memo when the resolved tokens change; not read in the factory call itself
    [min, max, themeVersion]
  )

  // Stable across renders (empty deps, or deps that only change when the
  // category lists themselves change) so HeatmapCell's memo() comparison
  // actually skips cells whose own props did not change, instead of seeing a
  // "new" handler identity every render and re-rendering everything anyway.
  const handleActivate = useCallback(
    (x: string, y: string) => {
      applyActiveCell({ x, y })
      positionTooltip(x, y)
    },
    [applyActiveCell, positionTooltip]
  )
  // The POINTER leaving a cell. Blur has its own handler below, so this one
  // never has to reason about when document.activeElement updates during a
  // focusout.
  const handleDeactivate = useCallback(
    (x: string, y: string) => {
      // A pointer leaving a cell that still holds DOM focus changes nothing:
      // focus has not moved, and that cell is still the one being read. Without
      // this, drifting the mouse off a focused cell closed its tooltip and
      // dropped its row/column band while it was still the focused cell.
      const node = cellRefs.current.get(cellKey(x, y))
      if (node && document.activeElement === node) return
      const active = activeCellRef.current
      if (!active || active.x !== x || active.y !== y) return
      // Hand the reading back to whatever cell still holds DOM focus, rather
      // than to nothing. Clearing outright left a keyboard user's focused cell
      // with its heavy ring but no tooltip and no row/column band, with no
      // focus change to justify losing either, and stuck that way until some
      // other focus or hover event arrived. Repositioning is not optional: the
      // tooltip was moved onto the departed cell when the pointer arrived
      // there, so restoring the focused cell's CONTENT without moving the
      // tooltip back would draw one cell's text over another cell.
      const focused = focusedCellRef.current
      applyActiveCell(focused)
      if (focused) positionTooltip(focused.x, focused.y)
    },
    [applyActiveCell, positionTooltip]
  )
  const handleFocusCell = useCallback(
    (x: string, y: string) => {
      applyFocusedCell({ x, y })
      setRovingCell({ x, y })
      applyActiveCell({ x, y })
      positionTooltip(x, y)
    },
    [applyActiveCell, applyFocusedCell, positionTooltip]
  )
  const handleBlurCell = useCallback(
    (x: string, y: string) => {
      const focused = focusedCellRef.current
      if (focused && focused.x === x && focused.y === y) applyFocusedCell(null)
      const active = activeCellRef.current
      if (active && active.x === x && active.y === y) applyActiveCell(null)
    },
    [applyActiveCell, applyFocusedCell]
  )
  const registerRef = useCallback((x: string, y: string, node: HTMLDivElement | null) => {
    const key = cellKey(x, y)
    if (node) cellRefs.current.set(key, node)
    else cellRefs.current.delete(key)
  }, [])
  // preventScroll plus an EXPLICIT scrollIntoView, rather than letting
  // .focus() scroll the cell into view implicitly.
  //
  // Blink, measured directly, scrolls BEFORE it dispatches the focus event (a
  // focus listener on an off-screen cell reads window.scrollY already at its
  // final value), so the implicit path happens to measure against the cell's
  // post-scroll rect there. That is engine behaviour, not a guarantee: the
  // HTML spec sequences the focusing steps before "scroll the element into
  // view", which puts the measurement one scroll behind. Owning the scroll
  // here makes the sequence explicit and the same everywhere: scroll first,
  // re-measure second, so the tooltip follows the cell to wherever the scroll
  // put it. It also means the scroll event that arrives afterwards finds an
  // anchor already matching the cell's new position, so nothing downstream
  // has to guess which scroll came from where.
  const focusCellAt = useCallback(
    (x: string, y: string) => {
      const node = cellRefs.current.get(cellKey(x, y))
      if (!node) return
      node.focus({ preventScroll: true })
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      positionTooltip(x, y)
    },
    [positionTooltip]
  )
  const handleNavigate = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, xi: number, yi: number) => {
      const next = nextRovingIndices(e.key, xi, yi, xCategories.length, yCategories.length)
      if (!next) return
      e.preventDefault()
      focusCellAt(xCategories[next.nextXi], yCategories[next.nextYi])
    },
    [xCategories, yCategories, focusCellAt]
  )

  // The roving cell defaults to the first cell, and falls back to it again if
  // a prior roving position no longer names a cell in THIS model (a swapped
  // visualization or a changed column mapping can shrink the axes out from
  // under a stale x/y), so the grid never ends up with zero tabbable cells.
  const effectiveRoving =
    rovingCell && xCategories.includes(rovingCell.x) && yCategories.includes(rovingCell.y)
      ? rovingCell
      : { x: xCategories[0], y: yCategories[0] }

  return {
    activeCell,
    focusedCell,
    tooltipPosition,
    measureTooltip,
    colorFor,
    inkFor,
    effectiveRoving,
    registerRef,
    handleActivate,
    handleDeactivate,
    handleFocusCell,
    handleBlurCell,
    handleNavigate,
  }
}
