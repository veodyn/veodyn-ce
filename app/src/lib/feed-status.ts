import { AlertTriangle, CircleCheck, XCircle } from 'lucide-react'
import type { Feed } from '@/types/feed'

/**
 * Freshness has to follow from the two columns shown next to it. A feed on an
 * "every 2 min" cadence whose last delivery was three days ago cannot be
 * "Fresh" under any definition, no matter what the upstream metadata claims.
 */

/**
 * How each status is named and iconified, in one place.
 *
 * The label and the icon were spelled out twice, in `freshness-badge.tsx` and
 * on the Feed Health page, and the pair had already drifted: `down` existed on
 * the board and not in the badge, so the catalog's worst verdict was "Stale"
 * while Feed Health called the same feed "Down". That was fixed by adding the
 * missing entry to one of the two copies, which left two copies.
 *
 * Two class strings rather than one, because the surfaces resolve contrast
 * differently and both choices are deliberate. The badge tints its background,
 * so its label takes the near-black ink token and the status colour lives on
 * the border and icon; the bare form sits on the page background, where the
 * status colour is safe on the text itself. Tailwind cannot assemble a class
 * name at runtime, so each variant is written out rather than derived.
 *
 * Callers keep their own icon sizing: only the icon's identity is shared.
 */
export const FEED_STATUS_META = {
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
  Feed['status'],
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
 * Seconds as a label `cadenceToMs` can parse back.
 *
 * The mirror of veodyn_api/services/feeds.py `cadence_label`, and the round
 * trip is the contract in both directions: a label this emits that cadenceToMs
 * cannot read silently disables the derivation and leaves every feed on its
 * declared status. Here so mock mode renders the same string the backend would,
 * rather than the board behaving differently with and without a backend.
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
 * Whether a feed's verdict was actually checked, or only repeated back.
 *
 * deriveFeedStatus falls back to the declared status when the cadence will not
 * parse, and that fallback is invisible: on the board a feed reading "Fresh"
 * because it was aged against a two-minute cadence looked identical to one
 * reading "Fresh" because the upstream said so and there was nothing to age it
 * against. Every feed on the stage instance reported a cadence of "not
 * scheduled", so the whole column was the second case wearing the first case's
 * clothes, and "Stale" had no declared interval to be stale against.
 */
export function feedStatusBasis(feed: Feed): 'derived' | 'reported' {
  return cadenceToMs(feed.cadence) == null ? 'reported' : 'derived'
}

/**
 * A feed is Fresh within two cadence periods of its last delivery, Stale up to
 * ten, and Down beyond that. Two periods absorbs ordinary jitter without
 * calling a plainly late feed healthy.
 *
 * `reported` is the upstream's own status: it can only make the verdict worse,
 * never better, so a backend that knows a feed is down is still believed.
 */
export function deriveFeedStatus(feed: Feed, now: number = Date.now()): Feed['status'] {
  const period = cadenceToMs(feed.cadence)
  const lastReceived = Date.parse(feed.lastReceivedAt)
  if (period == null || Number.isNaN(lastReceived)) return feed.status

  const age = now - lastReceived
  const derived: Feed['status'] = age <= period * 2 ? 'fresh' : age <= period * 10 ? 'stale' : 'down'

  const severity: Record<Feed['status'], number> = { fresh: 0, stale: 1, down: 2 }
  return severity[feed.status] > severity[derived] ? feed.status : derived
}
