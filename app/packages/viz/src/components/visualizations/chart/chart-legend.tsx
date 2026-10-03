'use client'

import type { DefaultLegendContentProps } from 'recharts'

// Replaces recharts' own bare Legend, which brings its own font stack, spacing,
// and colours and cannot be reached from the keyboard. Shape follows
// ChartTooltip: recharts hands us its payload and we own everything visual.
//
// The label wears a text token and never the series colour: coloured text on a
// card surface is the contrast risk the palette work spent Phase 1 avoiding,
// and the swatch beside it already carries identity. The swatch is
// aria-hidden, so the accessible name of each item is exactly its label.
//
// No tabIndex here: the list offers no operation, no arrow-key navigation, and
// no disclosure, so a tab stop on it would just be an inert landing point a
// keyboard user has to tab past on every multi-series chart on a dashboard.
// The list is already exposed to assistive technology as a labelled list via
// aria-label, which is what actually matters; nothing here needs focus.
export function ChartLegend({ payload }: Pick<Partial<DefaultLegendContentProps>, 'payload'>) {
  if (!payload?.length) return null

  return (
    <ul
      aria-label="Chart legend"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pt-2"
    >
      {payload.map((entry) => (
        <li key={String(entry.value)} className="flex items-center gap-1.5">
          <span
            data-slot="legend-swatch"
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-muted-foreground">{String(entry.value)}</span>
        </li>
      ))}
    </ul>
  )
}
