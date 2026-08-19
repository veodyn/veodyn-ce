'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { hasFeature } from '@/features'
import { useSetCaptureAlert, useSetCaptureExpectation } from '@/hooks/use-captures'
import { useToast } from '@/components/shared/toast-provider'
import { cadenceLabel, captureStatusBasis } from '@/lib/capture-status'
import type { Capture } from '@/types/capture'

/**
 * The intervals worth offering, rather than a free-text seconds field.
 *
 * A capture arriving on some interval nobody can name is not the case to
 * optimise for, and every value here round-trips through cadenceLabel into a
 * string cadenceToMs parses back, which is the property the whole derivation
 * depends on. A free number field would let someone enter 47 seconds and get a
 * label that silently turns the checking off again.
 */
const INTERVALS = [60, 300, 900, 3_600, 21_600, 86_400, 604_800] as const

/**
 * Declaring how often a capture should deliver.
 *
 * This is what gives the board a period to age against. Without one,
 * deriveCaptureStatus cannot judge a capture at all and falls back to
 * repeating the upstream's own status, which is the state every capture on
 * the instance was in: "not scheduled" in the Cadence column beside a Last
 * received of "59 seconds ago", and a Fresh verdict nobody had checked.
 *
 * Deliberately not writing a Redash schedule instead. The schedule says who
 * runs the capture; on this instance nothing in Redash does, something outside
 * it delivers every forty seconds, and setting one would describe a runner that
 * does not exist.
 */
export function ExpectedIntervalControl({ capture }: { capture: Capture }) {
  const setExpectation = useSetCaptureExpectation()
  const setAlert = useSetCaptureAlert()
  const toast = useToast()
  const [open, setOpen] = useState(false)

  const declared = capture.expectedIntervalSeconds ?? null
  const checked = captureStatusBasis(capture) === 'derived'

  function save(seconds: number | null) {
    setExpectation.mutate(
      { captureId: capture.id, seconds },
      {
        onSuccess: () => {
          setOpen(false)
          toast.success(
            seconds == null
              ? `${capture.name} is no longer checked against an expected interval.`
              : `${capture.name} is now expected ${cadenceLabel(seconds)}.`
          )
        },
        onError: () =>
          toast.error(`Could not save the expected interval for ${capture.name}. Nothing changed.`),
      }
    )
  }

  const armed = capture.alertId != null

  function toggleAlert() {
    setAlert.mutate(
      { captureId: capture.id, armed: !armed },
      {
        onSuccess: () =>
          toast.success(
            armed
              ? `No longer alerting when ${capture.name} is late.`
              : `Alerting when ${capture.name} goes quiet for twice its expected interval. Nobody is notified until you add a recipient.`
          ),
        onError: () => toast.error(`Could not change the alert for ${capture.name}. Nothing changed.`),
      }
    )
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-1.5 py-0.5 text-xs font-normal"
          onClick={() => setOpen(true)}
          // The row is one of several, so the name is what tells a screen reader
          // which capture this control belongs to.
          aria-label={`${checked ? 'Change' : 'Set'} the expected interval for ${capture.name}`}
        >
          {checked ? 'Change' : 'Set an expected interval'}
        </Button>
        {/* Only where there is a deadline to be late against. Offering it
            without one would mean inventing a deadline and then paging
            somebody about it. */}
        {declared != null && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1.5 py-0.5 text-xs font-normal"
            onClick={toggleAlert}
            disabled={setAlert.isPending}
            aria-label={`${armed ? 'Stop alerting' : 'Alert me'} when ${capture.name} is late`}
          >
            {armed ? 'Alerting' : 'Alert me when late'}
          </Button>
        )}
        {/* Straight to the alert, because recipients already live there. The
            alert page owns destinations, subscriptions, mute and the
            notification template, and it already renders a derived alert
            read-only apart from those. Rebuilding a destination picker here
            would be a second place to change who gets paged.

            Captures are community and alerts are not, so this is the one link
            across that line and it asks whether the destination exists first.
            The arming toggle above is NOT gated with it: a build without the
            alerts UI still has the backend that arms the check and still
            derives a late verdict from it, so what it loses is the page that
            edits recipients, not the alerting. */}
        {armed && capture.alertId != null && hasFeature('alerts') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1.5 py-0.5 text-xs font-normal"
            render={<Link href={`/alerts/${capture.alertId}`} />}
            aria-label={`Choose who is notified when ${capture.name} is late`}
          >
            Recipients
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`interval-${capture.id}`} className="sr-only">
        Expected interval for {capture.name}
      </Label>
      <Select
        value={declared == null ? '' : String(declared)}
        onValueChange={(next) => {
          if (next != null && next !== '') save(Number(next))
        }}
        disabled={setExpectation.isPending}
      >
        <SelectTrigger id={`interval-${capture.id}`} className="h-7 w-36 text-xs">
          <SelectValue placeholder="How often?" />
        </SelectTrigger>
        <SelectContent>
          {INTERVALS.map((seconds) => (
            <SelectItem key={seconds} value={String(seconds)}>
              {cadenceLabel(seconds)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {declared != null && (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-1.5 py-0.5 text-xs font-normal"
          onClick={() => save(null)}
          disabled={setExpectation.isPending}
        >
          Stop checking
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-auto px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
        onClick={() => setOpen(false)}
        disabled={setExpectation.isPending}
      >
        Cancel
      </Button>
    </div>
  )
}
