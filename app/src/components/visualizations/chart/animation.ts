/**
 * Recharts' draw-in animation never completes under React 19. A line is left
 * with its `stroke-dasharray` frozen a percent or so into the path length, and
 * a bar never gets its rect rendered at all, so a chart paints its axes,
 * gridlines, annotations and legend and then shows no data. It looks finished
 * and is empty.
 *
 * Every series has to opt out, so this lives in one place rather than as a
 * prop repeated per chart type: a new chart that forgets it is silently blank.
 */
export const SERIES_ANIMATION = { isAnimationActive: false } as const
