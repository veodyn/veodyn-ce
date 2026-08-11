'use client'

import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { cn } from '@/lib/utils'
import { cellKey } from './heatmap-cell-key'
import { buildHeatmapModel, describeHeatmapCell, shouldShowValues } from './heatmap-model'
import { HeatmapLegend } from './heatmap-legend'
import { HeatmapCell } from './heatmap-cell'
import {
  AXIS_TITLE_VIEWPORT_BOUND,
  GRID_HOST_BOUND,
  GRID_MIN_HEIGHT,
  GRID_VIEWPORT_BOUND,
  heatmapGridColumns,
  ROW_HEADER_CELL,
  ROW_HEADER_LABEL,
  STICKY_COLUMN_HEADER,
  STICKY_CORNER,
  STICKY_ROW_HEADER,
} from './heatmap-grid-chrome'
import { useHeatmapGridInteraction } from './use-heatmap-grid-interaction'
import { TOOLTIP_HALF_WIDTH } from './use-heatmap-tooltip'

interface HeatmapRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

// A stable empty Map/array so the "no model yet" render path never has to
// build a fresh reference every render before the hooks below it run.
const EMPTY_CATEGORIES: string[] = []
const EMPTY_CELLS = new Map<string, number>()


export function HeatmapRenderer({ visualization, data }: HeatmapRendererProps) {
  const options = useMemo(() => (visualization.options ?? {}) as RedashHeatmapOptions, [visualization.options])
  const model = useMemo(() => buildHeatmapModel(options, data), [options, data])

  // Every hook below has to run unconditionally, before the "no model" early
  // return further down, so each reads off the model with a fallback rather
  // than being skipped: a hook count that changes between renders (here,
  // between "model" and "no model") breaks React outright. useMemo, not a
  // bare `?? []`, so the fallback is a stable reference too: an inline `[]`
  // literal is a NEW array every render, which would make the interaction
  // hook's own memoized handlers look different on every render and defeat
  // the whole point of memoizing them.
  const xCategories = useMemo(() => model?.xCategories ?? EMPTY_CATEGORIES, [model])
  const yCategories = useMemo(() => model?.yCategories ?? EMPTY_CATEGORIES, [model])
  const cells = model?.cells ?? EMPTY_CELLS
  const min = model?.min ?? 0
  const max = model?.max ?? 1

  const {
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
  } = useHeatmapGridInteraction(xCategories, yCategories, min, max)

  if (!model) {
    return <div className="p-4 text-sm text-muted-foreground">Heatmap requires x, y, and value columns.</div>
  }

  const { cellCount, valueLabel, xLabel, yLabel } = model
  const showValues = shouldShowValues(options.showValues, cellCount)

  const activeDescription = activeCell
    ? describeHeatmapCell(activeCell.x, activeCell.y, cells.get(cellKey(activeCell.x, activeCell.y)))
    : null

  return (
    // h-full plus the min-h-0 chain below it is what lets GRID_HOST_BOUND
    // reach the scrollport: without min-h-0 at every level, a flex item's
    // automatic minimum size is its content, and the scroller would refuse to
    // shrink below the whole grid no matter what the host said.
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="flex min-h-0 min-w-0 flex-1 gap-2">
        {/* The y axis title, rotated to run up the side of the grid the way
            an axis title does on every other chart here. Outside the
            scrolling wrapper on purpose: it names the whole axis, so it
            should not slide away when the grid scrolls sideways.
            Bounded and truncated for the same reason the x title is, and
            with more at stake: in vertical writing mode the INLINE axis is
            vertical, so an unbounded long column name runs the full height of
            the rotated text, stretches the axes row to match, and in a short
            host pushes the root past the host box, which hands scrolling back
            to the host and undoes the single-scroller guarantee. min-h-0 and
            overflow-hidden on the wrapper so the span can never do that: a
            flex item's automatic minimum size is its content, so without
            min-h-0 the wrapper refuses to shrink below the rotated text
            however long it is. overflow-hidden on the wrapper, not a
            max-height on the span: two max-height classes on one element
            collapse to the later one under tailwind-merge, so the pair this
            used to carry only ever applied half of itself. */}
        <div className="flex min-h-0 shrink-0 items-center overflow-hidden">
          <span
            className={cn(
              AXIS_TITLE_VIEWPORT_BOUND,
              '[writing-mode:vertical-rl] rotate-180 truncate text-xs text-muted-foreground'
            )}
            title={yLabel}
          >
            {yLabel}
          </span>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 truncate pb-1 text-center text-xs text-muted-foreground" title={xLabel}>
            {xLabel}
          </div>
          {/* The scrollport. Both header bands stick against THIS element, so
              it is the one that has to be bounded on both axes; see the two
              bounds above. It carries no padding of its own, so a header stuck
              at left-0 or top-0 lands flush against the visible edge of the
              grid rather than a padding-width inside it, with no strip for
              cells to show through. */}
          <div className={cn(GRID_HOST_BOUND, GRID_MIN_HEIGHT, GRID_VIEWPORT_BOUND, 'overflow-auto')}>
            <div
              role="grid"
              aria-label={`${valueLabel} heatmap, ${xLabel} by ${yLabel}`}
              className="grid gap-0.5"
              style={{ gridTemplateColumns: heatmapGridColumns(xCategories.length) }}
            >
              {/* display: contents keeps this wrapper's children as direct items of
                  the CSS grid above (the column count in gridTemplateColumns only
                  works if row header + cells are its direct children), while still
                  giving the header band its own role="row": verified directly
                  (see Task 5's report) that a display:contents element carrying
                  role="row" still appears, un-ignored, in Chromium's real
                  accessibility tree, with its columnheader children correctly
                  nested under it. Not verified against Firefox/WebKit; this
                  project's e2e suite only exercises Chromium.

                  It is also why sticky lives on the header CELLS and not on
                  this element: display: contents generates no box at all, so
                  position: sticky on it would do nothing. Measured, not
                  assumed. */}
              <div role="row" className="contents">
                {/* A real (blank) columnheader, not aria-hidden: role="row" requires
                    its owned children to be columnheader/gridcell/rowheader, and
                    hiding this one would leave the row's first column without a
                    header cell in the accessibility tree at all. */}
                <div role="columnheader" className={STICKY_CORNER} />
                {xCategories.map((x) => (
                  <div
                    key={x}
                    role="columnheader"
                    className={cn(
                      STICKY_COLUMN_HEADER,
                      'text-xs text-center px-1 py-1 truncate',
                      activeCell?.x === x ? 'text-foreground font-semibold' : 'text-muted-foreground'
                    )}
                    title={x}
                  >
                    {x}
                  </div>
                ))}
              </div>
              {yCategories.map((y, yi) => (
                <div key={y} role="row" className="contents">
                  <div
                    role="rowheader"
                    className={cn(
                      STICKY_ROW_HEADER,
                      ROW_HEADER_CELL,
                      activeCell?.y === y ? 'text-foreground font-semibold' : 'text-muted-foreground'
                    )}
                    title={y}
                  >
                    <span className={ROW_HEADER_LABEL}>{y}</span>
                  </div>
                  {xCategories.map((x, xi) => {
                    const value = cells.get(cellKey(x, y))
                    const isRowActive = activeCell?.y === y
                    const isColActive = activeCell?.x === x
                    const isActiveCell = isRowActive && isColActive
                    const description = describeHeatmapCell(x, y, value)
                    return (
                      <HeatmapCell
                        key={`${x}-${y}`}
                        x={x}
                        y={y}
                        xi={xi}
                        yi={yi}
                        value={value}
                        showValues={showValues}
                        backgroundColor={value != null ? colorFor(value) : 'var(--muted)'}
                        color={value != null ? inkFor(value) : undefined}
                        isRowActive={isRowActive}
                        isColActive={isColActive}
                        isActiveCell={isActiveCell}
                        isFocused={focusedCell?.x === x && focusedCell?.y === y}
                        tabIndex={effectiveRoving.x === x && effectiveRoving.y === y ? 0 : -1}
                        description={description}
                        onActivate={handleActivate}
                        onDeactivate={handleDeactivate}
                        onFocusCell={handleFocusCell}
                        onBlurCell={handleBlurCell}
                        onNavigate={handleNavigate}
                        registerRef={registerRef}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          {/* Inside the grid's own column, not beside it: as a sibling of the
              row that holds the rotated y-axis title, the legend started at
              the card's left edge, so its value label sat under that title
              and read as having escaped the plot at the corner. shrink-0 so
              it keeps its height and the scroller above absorbs whatever the
              host box gives them between them. Wrapped rather than passed a
              className, since HeatmapLegend takes no styling props and this
              is the caller's layout concern, not the legend's. */}
          <div className="shrink-0">
            <HeatmapLegend min={min} max={max} valueLabel={valueLabel} clipped={model.clipped} />
          </div>
        </div>
      </div>
      {typeof document !== 'undefined' &&
        activeCell &&
        tooltipPosition &&
        createPortal(
          // aria-hidden: the active cell's own aria-label already carries
          // this exact text, so a screen reader has already announced it the
          // moment the cell got focus. Without this the floating copy would
          // be read a second time as the user's virtual cursor walks past it
          // in DOM order.
          <div
            role="tooltip"
            aria-hidden="true"
            // Inline, not the memoized callback itself, so React re-invokes
            // it on every render of this tooltip rather than only on mount.
            // measureTooltip reads the tooltip's real height and the cell's
            // post-commit rect, neither of which exists when positionTooltip
            // runs inside the event handler.
            ref={(node) => measureTooltip(node)}
            className="pointer-events-none fixed z-50 rounded-md border bg-card px-3 py-2 text-sm text-card-foreground shadow-md"
            style={{
              // Capped at twice the constant positionTooltip clamps the
              // horizontal anchor by, so that clamp keeps holding for a long
              // category label: unbounded (the previous whitespace-nowrap,
              // no max-width shape) a wide enough label pushed the tooltip
              // back off the viewport edge the clamp exists to keep it
              // inside. Wrapping, not truncating, since the exact value this
              // tooltip carries is the whole reason it exists; the vertical
              // placement measures the wrapped height rather than assuming
              // one line.
              maxWidth: TOOLTIP_HALF_WIDTH * 2,
              top: tooltipPosition.top,
              left: tooltipPosition.left,
              transform: tooltipPosition.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            {activeDescription}
          </div>,
          document.body
        )}
    </div>
  )
}
