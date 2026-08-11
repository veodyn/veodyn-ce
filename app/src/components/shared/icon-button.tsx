'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type TooltipSide = ComponentProps<typeof TooltipContent>['side']

interface IconButtonProps extends ComponentProps<typeof Button> {
  /**
   * What the click does, in the words a person would use for it ("Remove
   * widget", not "Remove"). Shown on hover and on keyboard focus.
   */
  tooltip: ReactNode
  /** Which edge the bubble sits on. Top unless the control is near the top. */
  side?: TooltipSide
}

/**
 * A button whose entire label is an icon, wrapped in the shadcn tooltip so the
 * icon is not the only explanation of what it does.
 *
 * The tooltip doubles as the accessible name when it is a plain string, so a
 * caller cannot add one and forget the other. Pass `aria-label` explicitly when
 * the two should differ: a row action reads better as a specific name to a
 * screen reader ("Delete Weekly revenue") than the short verb the pointer needs.
 *
 * Not for buttons that already carry visible text. A tooltip that repeats a
 * label is noise, and hover text is the wrong place for anything a person must
 * read: it never appears on touch.
 *
 * Known gap: a `disabled` button takes no pointer events (Button's own
 * `disabled:pointer-events-none`), so a greyed-out control stays silent about
 * why. Say it somewhere durable instead of relying on this.
 */
export function IconButton({ tooltip, side = 'top', children, ...props }: IconButtonProps) {
  const label = props['aria-label'] ?? (typeof tooltip === 'string' ? tooltip : undefined)
  return (
    <Tooltip>
      <TooltipTrigger render={<Button {...props} aria-label={label} />}>{children}</TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
