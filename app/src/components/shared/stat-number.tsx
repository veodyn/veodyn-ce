'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { DeltaChip } from './delta-chip'
import { MICRO_SUBLABEL } from '@/lib/section-heading'
import type { Direction } from '@/types/metric'

export interface StatNumberProps {
  value: number
  label?: string
  unit?: string
  delta?: number
  /**
   * The unit the delta is expressed in, when it differs from the value's.
   * A KPI's delta is in the value's own unit (82% down 6 points), but a hub
   * counter's is a period-over-period percentage against an absolute count
   * (342,910 boardings up 1.8%). Defaults to `unit`.
   */
  deltaUnit?: string
  /** Whether a rising delta is good news. Passed straight to DeltaChip. */
  direction?: Direction
  target?: number
  refreshKey?: unknown
  className?: string
  valueClassName?: string
}

// Matches --motion-duration-slow in globals.css; the count-up interpolates
// over this window when motion is not reduced.
const COUNT_UP_DURATION_MS = 360

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// Approximates cubic-bezier(0.2, 0, 0, 1) (the --motion-ease-standard curve)
// closely enough for a JS-driven interpolation: fast start, gentle settle.
function easeOutStandard(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function StatNumber({
  value,
  label,
  unit,
  delta,
  deltaUnit,
  direction,
  target,
  refreshKey,
  className,
  valueClassName,
}: StatNumberProps) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(() => (reduced ? value : 0))
  const displayRef = useRef(display)
  const rafRef = useRef<number | null>(null)
  // False until the first count-up runs. useReducedMotion's server/hydration
  // snapshot is always `true`, so the first client render sees reduced=true and
  // seeds displayRef to `value`; when React corrects to reduced=false the
  // count-up must still start from 0, not from that seeded final value, or it
  // would never play on initial page load. So the FIRST animation anchors at 0.
  const animatedOnceRef = useRef(false)

  // Reduced motion short-circuits to the final value with no rAF loop at
  // all: `shown` is a plain derived value (never reads or writes the ref
  // during render), so there is no render-phase ref access and nothing to
  // keep in sync via an effect for this branch.
  const shown = reduced ? value : display

  // Count-up: interpolates the displayed number from its previous value to
  // `value` over COUNT_UP_DURATION_MS. When reduced, this effect only keeps
  // the "from" anchor (a ref, not state) caught up to `value` for whenever
  // motion later becomes un-reduced; it never calls setState. When not
  // reduced, setDisplay is called inside the rAF callback (an external
  // system's async callback), never synchronously in the effect body.
  useEffect(() => {
    if (reduced) {
      displayRef.current = value
      return
    }

    // The first count-up anchors at 0 (see animatedOnceRef above) so it plays
    // on initial load; later value changes continue from the last shown value.
    const from = animatedOnceRef.current ? displayRef.current : 0
    animatedOnceRef.current = true
    const to = value
    if (from === to) return

    const start = performance.now()

    const step = (now: number) => {
      const t = clamp((now - start) / COUNT_UP_DURATION_MS, 0, 1)
      // Snap exactly to the target on the final frame: float interpolation can
      // land numerically adjacent to (not strictly equal to) `to`, which would
      // fail the settled-value exactness check below and misreport a
      // non-integer final value.
      const next = t < 1 ? from + (to - from) * easeOutStandard(t) : to
      displayRef.current = next
      setDisplay(next)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(step)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [value, reduced])

  // Refresh pulse: replays once per refreshKey change (never on first
  // render) when motion is not reduced. Adjusted directly during render
  // (React's documented pattern for state derived from a prop change)
  // rather than in an effect, so this has no setState-in-effect either. The
  // row below is keyed on pulseTick so the CSS animation restarts on every
  // subsequent refresh, not just the first.
  const [prevRefreshKey, setPrevRefreshKey] = useState(refreshKey)
  const [pulseTick, setPulseTick] = useState(0)

  if (refreshKey !== prevRefreshKey) {
    setPrevRefreshKey(refreshKey)
    if (!reduced) {
      setPulseTick((n) => n + 1)
    }
  }

  // The settled display (shown === value, i.e. reduced motion or the count-up
  // has landed at t=1) shows the exact value with full precision: rounding a
  // non-integer final value (e.g. 99.95 -> "100" under maximumFractionDigits:
  // 1) would misreport it. Only the mid-flight interpolated frames, which are
  // not the value of record, get rounded for a readable count-up.
  const formattedValue =
    shown === value
      ? value.toLocaleString()
      : shown.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 })

  const suffix = unit ? (unit === '%' ? '%' : ` ${unit}`) : ''
  const resolvedValueClassName = valueClassName ?? 'text-3xl'
  const shouldPulse = pulseTick > 0 && !reduced
  // Guard target <= 0: a 0/0 would produce NaN width (invalid CSS), so a
  // non-positive target renders an empty bar.
  const fillPercent =
    target !== undefined ? (target > 0 ? clamp((value / target) * 100, 0, 100) : 0) : undefined

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <span className={MICRO_SUBLABEL}>{label}</span>
      )}
      <div
        key={pulseTick}
        className={cn(
          'flex items-baseline gap-2',
          shouldPulse && 'animate-[veodyn-pulse_var(--motion-duration-slow)_ease-out]'
        )}
      >
        <span className={cn('font-mono tabular-nums', resolvedValueClassName)}>
          {formattedValue}
          {suffix}
        </span>
        {delta !== undefined && (
          <DeltaChip delta={delta} unit={deltaUnit ?? unit} direction={direction} />
        )}
      </div>
      {fillPercent !== undefined && (
        <div className="h-1 rounded-full bg-muted">
          <div
            data-testid="stat-fillbar"
            className={cn(
              'h-full rounded-full bg-primary',
              !reduced && 'transition-[width] duration-(--motion-duration-base) ease-(--motion-ease-standard)'
            )}
            style={{ width: `${fillPercent}%` }}
          />
        </div>
      )}
    </div>
  )
}
