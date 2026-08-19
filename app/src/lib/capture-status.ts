import { AlertTriangle, CircleCheck, XCircle } from 'lucide-react'
import type { Capture } from '@/types/capture'

/**
 * How each status is named and iconified, for `freshness-badge.tsx` and the
 * Captures board alike.
 *
 * Two class strings because the surfaces resolve contrast differently: the
 * badge tints its background and carries the status colour on border and icon,
 * the bare form carries it on the text. Written out per variant, since Tailwind
 * cannot assemble a class name at runtime.
 *
 * Callers keep their own icon sizing: only the icon's identity is shared.
 */
export const CAPTURE_STATUS_META = {
  fresh: {
    label: 'Fresh',
    Icon: CircleCheck,
    text: 'text-status-fresh',
    badge: 'border-status-fresh bg-status-fresh/10 text-status-fresh',
  },
  stale: {
    label: 'Stale',
    Icon: AlertTriangle,
    text: 'text-status-stale',
    badge: 'border-status-stale bg-status-stale/10 text-status-stale',
  },
  down: {
    label: 'Down',
    Icon: XCircle,
    text: 'text-destructive',
    badge: 'border-destructive bg-destructive/10 text-destructive',
  },
} as const satisfies Record<
  Capture['status'],
  { label: string; Icon: typeof CircleCheck; text: string; badge: string }
>

/** Parse the human cadence string into milliseconds. Returns null if unknown. */
export function cadenceToMs(cadence: string): number | null {
  const normalized = cadence.trim().toLowerCase()

  const named: Record<string, number> = {
    realtime: 60_000,
    'real-time': 60_000,
    minutely: 60_000,
    hourly: 3_600_000,
    daily: 86_400_000,
    weekly: 604_800_000,
  }
  if (named[normalized] != null) return named[normalized]

  // "every 5 min", "every 2 minutes", "every 6 hours", "every 1 day"
  const match = normalized.match(/(\d+)\s*(sec|second|min|minute|hour|day|week)s?/)
  if (!match) return null
  const amount = Number(match[1])
  const unitMs: Record<string, number> = {
    sec: 1_000,
    second: 1_000,
    min: 60_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
  }
  const unit = unitMs[match[2]]
  return unit ? amount * unit : null
}

// Largest unit first, so 300 reads "every 5 min" rather than "every 300 sec".
const CADENCE_UNITS: [number, string][] = [
  [604_800, 'week'],
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'min'],
]
const CADENCE_NAMES: Record<number, string> = {
  60: 'minutely',
  3_600: 'hourly',
  86_400: 'daily',
  604_800: 'weekly',
}

/**
 * Seconds as a label `cadenceToMs` can parse back. Mirrors `cadence_label` in
 * veodyn_api/services/captures.py, and the round trip is the contract: a label
 * cadenceToMs cannot read silently disables the derivation below.
 */
export function cadenceLabel(seconds: number): string {
  if (seconds <= 0) return 'not scheduled'
  if (CADENCE_NAMES[seconds]) return CADENCE_NAMES[seconds]
  for (const [size, unit] of CADENCE_UNITS) {
    if (seconds % size === 0) {
      const count = seconds / size
      return `every ${count} ${unit}${count === 1 ? '' : 's'}`
    }
  }
  return `every ${seconds} secs`
}

/**
 * Whether a capture's verdict was actually checked, or only repeated back:
 * deriveCaptureStatus falls back to the declared status when the cadence will
 * not parse, and that fallback is otherwise invisible on the board.
 */
export function captureStatusBasis(capture: Capture): 'derived' | 'reported' {
  return cadenceToMs(capture.cadence) == null ? 'reported' : 'derived'
}

/**
 * A capture is Fresh within two cadence periods of its last delivery, Stale up
 * to ten, and Down beyond that. Two periods absorbs ordinary jitter without
 * calling a plainly late capture healthy.
 *
 * `reported` is the upstream's own status: it can only make the verdict worse,
 * never better, so a backend that knows a capture is down is still believed.
 */
export function deriveCaptureStatus(capture: Capture, now: number = Date.now()): Capture['status'] {
  const period = cadenceToMs(capture.cadence)
  const lastReceived = Date.parse(capture.lastReceivedAt)
  if (period == null || Number.isNaN(lastReceived)) return capture.status

  const age = now - lastReceived
  const derived: Capture['status'] = age <= period * 2 ? 'fresh' : age <= period * 10 ? 'stale' : 'down'

  const severity: Record<Capture['status'], number> = { fresh: 0, stale: 1, down: 2 }
  return severity[capture.status] > severity[derived] ? capture.status : derived
}
