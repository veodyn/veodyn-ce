import { type Page } from '@playwright/test'
import { gridScroller } from './heatmap-interaction-helpers'

// Shared measurement for the two sticky-header specs (query-editor host and
// dashboard-widget host), which assert the same relationships against
// different hosts. Setup and measurement only; every assertion stays in the
// spec files.

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

export interface Geometry {
  scroller: Rect
  scrollerHeight: number
  scrollerCanScrollX: boolean
  scrollerCanScrollY: boolean
  overflowX: string
  overflowY: string
  scrollLeft: number
  scrollTop: number
  corner: Rect
  rowHeader: Rect
  columnHeader: Rect
  firstCell: Rect
  // Whether the point at each header's own centre actually hits that header.
  // A rect comparison cannot see stacking order, so a header that stays put but
  // is painted UNDER the cells sliding beneath it passes every geometric
  // assertion and is still invisible to a reader.
  rowHeaderOnTop: boolean
  columnHeaderOnTop: boolean
  // The header cells' RESOLVED background alpha, not their class list and not
  // just "is it different from transparent". A sticky header with no background
  // lets the cells scrolling under it show straight through, which no rect and
  // no hit test can see (elementFromPoint reports the header whether or not it
  // paints anything). Alpha rather than the colour string because a TRANSLUCENT
  // background is the same defect in weaker form: `bg-card/50` resolves to
  // `rgba(..., 0.5)`, which is not equal to `rgba(0, 0, 0, 0)` and would pass a
  // simple inequality check while the cells still show through.
  columnHeaderAlpha: number
  rowHeaderAlpha: number
  cornerAlpha: number
  // Whether the row header's own text fits the width the grid gave it. A header
  // that sticks but has been squeezed to a few pixels keeps nothing readable on
  // screen, which is the entire point of sticking it.
  rowHeaderClipped: boolean
  rowHeaderText: string
  rowHeaderWidth: number
  // Every ancestor of the grid (the renderer's own scrollport included) whose
  // computed overflow-y makes it a scroll container, and whether it is
  // ACTUALLY overflowing. The renderer renders inside seven host boxes and some
  // of them are scrollers in their own right; when two of them overflow at
  // once, the user gets nested scrollbars and scrolling the outer one carries
  // the stuck header off screen regardless of how well it sticks to the inner.
  verticalScrollers: { label: string; scrolls: boolean; height: number }[]
}

// `scope` names the container to look for the grid inside, so a page holding
// more than one heatmap (a dashboard with two heatmap widgets, or a widget with
// its expanded dialog open over it) measures the one the test means rather than
// whichever comes first in the document.
export async function measure(page: Page, scope = 'body'): Promise<Geometry> {
  return page.evaluate((scopeSelector) => {
    const container = document.querySelector(scopeSelector) as HTMLElement
    if (!container) throw new Error(`[heatmap-sticky] no element matched scope ${scopeSelector}`)
    const grid = container.querySelector('[role="grid"]') as HTMLElement
    if (!grid) throw new Error(`[heatmap-sticky] no [role="grid"] inside ${scopeSelector}`)
    const scroller = grid.parentElement as HTMLElement
    const rows = grid.querySelectorAll<HTMLElement>('[role="row"]')
    const headerBand = rows[0]
    const dataRow = rows[1]
    const corner = headerBand.querySelectorAll<HTMLElement>('[role="columnheader"]')[0]
    const columnHeader = headerBand.querySelectorAll<HTMLElement>('[role="columnheader"]')[1]
    const rowHeader = dataRow.querySelector<HTMLElement>('[role="rowheader"]') as HTMLElement
    const firstCell = dataRow.querySelector<HTMLElement>('[role="gridcell"]') as HTMLElement

    const rect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const hits = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
      return at != null && (at === el || el.contains(at))
    }

    const verticalScrollers: { label: string; scrolls: boolean; height: number }[] = []
    for (let el: HTMLElement | null = scroller; el != null; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue
      verticalScrollers.push({
        label: el === scroller ? 'renderer' : el.className.toString().slice(0, 60) || el.tagName,
        scrolls: el.scrollHeight > el.clientHeight,
        height: Math.round(el.getBoundingClientRect().height),
      })
    }

    // Computed backgrounds resolve to `rgb(r, g, b)` when fully opaque and
    // `rgba(r, g, b, a)` otherwise, so a missing fourth component means alpha 1.
    //
    // Narrow on purpose, and only safe for the `=== 1` comparison the specs
    // make: it reads ANY three-number colour as opaque, and a percentage alpha
    // (`rgb(0 0 0 / 50%)`, which Chromium does not currently emit here) would
    // come back as 50 rather than 0.5. Reusing it for anything finer than
    // "fully opaque or not" needs it rewritten first.
    const alphaOf = (el: HTMLElement) => {
      const parts = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)
      if (!parts) return 0
      return parts.length < 4 ? 1 : Number(parts[3])
    }

    const style = getComputedStyle(scroller)
    return {
      scroller: rect(scroller),
      scrollerHeight: Math.round(scroller.getBoundingClientRect().height),
      scrollerCanScrollX: scroller.scrollWidth > scroller.clientWidth,
      scrollerCanScrollY: scroller.scrollHeight > scroller.clientHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      corner: rect(corner),
      rowHeader: rect(rowHeader),
      columnHeader: rect(columnHeader),
      firstCell: rect(firstCell),
      rowHeaderOnTop: hits(rowHeader),
      columnHeaderOnTop: hits(columnHeader),
      columnHeaderAlpha: alphaOf(columnHeader),
      rowHeaderAlpha: alphaOf(rowHeader),
      cornerAlpha: alphaOf(corner),
      rowHeaderClipped: rowHeader.scrollWidth > rowHeader.clientWidth + 1,
      rowHeaderText: rowHeader.textContent ?? '',
      rowHeaderWidth: rowHeader.getBoundingClientRect().width,
      verticalScrollers,
    }
  }, scope)
}

// What each test ASKS for. The browser clamps a scroll to what the content
// allows, and the wide fixture's 30 columns of 2.5rem only overflow by about
// 330px at this viewport, so the achieved scroll is read back and used for the
// delta assertions rather than assumed to be this number. Asking for more than
// is available is deliberate: it scrolls each axis to its own end, which is the
// position a reader who has lost the labels is actually at.
export const SCROLL_REQUEST = 4000
// The floor the achieved scroll has to clear for a test to be about anything.
// Far enough that no sub-pixel tolerance can account for it, and far enough
// that the cell it moves ends up well clear of the header it started beside.
export const MIN_SCROLL = 200
// Layout rounds; a header that has genuinely stayed put still measures a
// fraction of a pixel off after a scroll on a fractional device ratio.
export const EPSILON = 1.5
// Scrolls one axis to the end and reports what the browser actually did, which
// is not what it was asked for: a scroll is clamped to the content's own
// overflow. Every delta assertion downstream is written against this returned
// number rather than the request, so the tests measure the real movement.
export async function scrollTo(page: Page, axis: 'scrollLeft' | 'scrollTop', scope = 'body'): Promise<number> {
  return gridScroller(page, scope).evaluate(
    (el, { key, amount }) => {
      el[key] = amount
      return el[key]
    },
    { key: axis, amount: SCROLL_REQUEST }
  )
}
