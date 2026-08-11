'use client'

// The Visualization half of the Visual builder: pick how the answer should look.
//
// This was a select reading "Table". Choosing a visualization is a visual act,
// and a dropdown of type names is the least visual control on the screen: it
// shows nothing of what any option produces, and it hid the five chart shapes
// behind one "Chart" entry so the shape only became pickable later, after a run.
import { useConfig } from '@/components/config/config-provider'
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group'
import { visibleVizChoices } from '@/lib/viz-choices'

export interface VisualBuilderVizPickerProps {
  /** A viz choice id, not a Redash visualization type. */
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}

export function VisualBuilderVizPicker({
  value,
  disabled = false,
  onChange,
}: VisualBuilderVizPickerProps) {
  // Instance visibility, so a type this deployment does not want, or keeps for
  // its wall screens, has no tile here. Unset means every tile this build can
  // draw.
  const { visualizations } = useConfig()
  const choices = visibleVizChoices(visualizations)

  // An allowlist naming only types with no builder tile (or nothing this build
  // has) leaves the grid empty. Say so, rather than showing an empty box that
  // reads as a rendering failure.
  if (choices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No visualization types are enabled for this instance.
      </p>
    )
  }

  return (
    // A radio group, not a set of toggle buttons: exactly one of these is in
    // effect. Base UI gives the roving focus and arrow-key movement that comes
    // with the role, so there is no keydown handler here to get wrong.
    <RadioGroup
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next)
      }}
      aria-label="Visualization type"
      className="grid-cols-2 sm:grid-cols-3"
    >
      {choices.map(({ id, label, Thumbnail }) => (
        <RadioGroupCard key={id} value={id}>
          <Thumbnail />
          {label}
        </RadioGroupCard>
      ))}
    </RadioGroup>
  )
}
