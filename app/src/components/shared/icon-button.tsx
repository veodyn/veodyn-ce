'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type TooltipSide = ComponentProps<typeof TooltipContent>['side']

interface IconButtonProps extends ComponentProps<typeof Button> {
  /** What the click does ("Remove widget", not "Remove"). Shown on hover and focus. */
  tooltip: ReactNode
  /** Which edge the bubble sits on. Top unless the control is near the top. */
  side?: TooltipSide
}

/**
 * A button whose entire label is an icon, wrapped in the shadcn tooltip.
 *
 * A plain-string tooltip doubles as the accessible name, so the two cannot
 * drift. Pass `aria-label` as well when they should differ ("Delete Weekly
 * revenue" against a tooltip of "Delete"). Not for buttons that already carry
 * visible text, and note a `disabled` button takes no pointer events
 * (`disabled:pointer-events-none`), so its tooltip never shows.
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
