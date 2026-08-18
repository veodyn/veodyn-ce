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

  // Every hook below runs unconditionally, before the "no model" early return,
  // because a hook count that changes between renders breaks React. useMemo
  // rather than a bare `?? []` so the fallback keeps a stable reference and the
  // interaction hook's memoized handlers survive a render.
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
    // h-full plus the min-h-0 chain below it is what lets GRID_HOST_BOUND reach
    // the scrollport: a flex item's automatic minimum size is its content, so
    // without min-h-0 at every level the scroller refuses to shrink.
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="flex min-h-0 min-w-0 flex-1 gap-2">
        {/* The rotated y axis title, outside the scrolling wrapper so it does
            not slide away when the grid scrolls sideways. In vertical writing
            mode the inline axis is vertical, so a long column name runs the
            full height of the rotated text and stretches the axes row: min-h-0
            plus overflow-hidden on the wrapper bounds it. overflow-hidden on
            the wrapper rather than a second max-height on the span, because
            two max-height classes on one element collapse to the later one
            under tailwind-merge. */}
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
          {/* The scrollport. Both header bands stick against this element, so
              it is the one bounded on both axes. It carries no padding of its
              own, so a header stuck at left-0 or top-0 lands flush against the
              visible edge of the grid, with no strip for cells to show
              through. */}
          <div className={cn(GRID_HOST_BOUND, GRID_MIN_HEIGHT, GRID_VIEWPORT_BOUND, 'overflow-auto')}>
            <div
              role="grid"
              aria-label={`${valueLabel} heatmap, ${xLabel} by ${yLabel}`}
              className="grid gap-0.5"
              style={{ gridTemplateColumns: heatmapGridColumns(xCategories.length) }}
            >
              {/* display: contents keeps these children direct items of the grid
                  above (gridTemplateColumns only counts direct children) while
                  still giving the band its own role="row", which was checked in
                  Chromium's accessibility tree and not in Firefox or WebKit. It
                  generates no box, so sticky lives on the header cells. */}
              <div role="row" className="contents">
                {/* A real (blank) columnheader, not aria-hidden: role="row" owns
                    only columnheader/gridcell/rowheader children, so hiding this
                    one leaves the first column with no header cell. */}
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
          {/* Inside the grid's own column, not beside it, or the legend starts
              at the card's left edge under the rotated y-axis title. shrink-0
              so it keeps its height and the scroller above absorbs the rest.
              Wrapped because HeatmapLegend takes no styling props. */}
          <div className="shrink-0">
            <HeatmapLegend min={min} max={max} valueLabel={valueLabel} clipped={model.clipped} />
          </div>
        </div>
      </div>
      {typeof document !== 'undefined' &&
        activeCell &&
        tooltipPosition &&
        createPortal(
          // aria-hidden: the active cell's own aria-label already carries this
          // exact text, so without it a virtual cursor reads the value twice.
          <div
            role="tooltip"
            aria-hidden="true"
            // Inline, not the memoized callback itself, so React re-invokes it
            // on every render rather than only on mount: measureTooltip reads
            // the tooltip's real height and the cell's post-commit rect.
            ref={(node) => measureTooltip(node)}
            className="pointer-events-none fixed z-50 rounded-md border bg-card px-3 py-2 text-sm text-card-foreground shadow-md"
            style={{
              // Twice the constant positionTooltip clamps the horizontal anchor
              // by, so that clamp keeps holding for a long category label. It
              // wraps rather than truncates, and the vertical placement
              // measures the wrapped height.
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
