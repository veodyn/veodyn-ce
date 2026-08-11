"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "@/lib/utils"

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

/**
 * A radio rendered as a tile rather than a dot: for choosing between things best
 * shown as pictures. Takes arbitrary children (a thumbnail, a label) and marks
 * the selection with a border and a ring, there being no indicator to fill.
 *
 * A sibling of RadioGroupItem rather than a restyled one, whose class list is
 * entirely dot-shaped (`aspect-square size-4 rounded-full`, plus a filled
 * `data-checked:bg-primary`): reusing it here means overriding most of it.
 */
function RadioGroupCard({ className, children, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-card"
      className={cn(
        // The checked state is a border, a 2px ring and a tint together, not a
        // tint alone. A tile grid has the same problem the dimension chips on the
        // query editor had: one step of background against a near-identical
        // background reads as "nothing is selected", and hovering an unchecked
        // tile then looks exactly like a checked one.
        "group/radio-group-card flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent p-2 text-xs font-medium text-muted-foreground outline-none transition-colors select-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary/10 data-checked:text-foreground data-checked:ring-2 data-checked:ring-primary dark:bg-input/30 dark:hover:bg-input/50",
        className
      )}
      {...props}
    >
      {children}
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupCard, RadioGroupItem }
