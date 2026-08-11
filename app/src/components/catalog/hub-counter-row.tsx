'use client'

// A hub's counter row: the grid, and every counter this build can render on its
// own. A counter that names a `kpiId` asks the `catalog.hubCounters` slot for
// its tile, so the KPI-backed treatment (a live scorecard plus the age of the
// data under it) arrives from the KPI feature rather than being imported here.
//
// The grid stays with this component on purpose. A slot that owned the whole
// row would put the layout in the feature and leave a community hub laid out by
// code it does not have; slotting one tile at a time means a community hub and
// an enterprise hub are the same grid with different tiles in it.
import type { HubCounter } from '@/types/catalog'
import { StatNumber } from '@/components/shared/stat-number'
import { Slot } from '@/features/slots'

/** What every build can render for a counter: the number that is written on it. */
function StaticCounter({ counter }: { counter: HubCounter }) {
  return (
    <StatNumber
      label={counter.label}
      value={counter.value}
      unit={counter.unit}
      delta={counter.delta}
      deltaUnit={counter.deltaUnit}
    />
  )
}

export function HubCounterRow({ counters }: { counters: HubCounter[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {counters.map((counter) =>
        // Only a counter that names a KPI has anything to ask for. Every other
        // one is rendered here with no loader entered and no slot involved.
        counter.kpiId ? (
          <Slot
            key={counter.label}
            id="catalog.hubCounters"
            props={{ counter }}
            fallback={<StaticCounter counter={counter} />}
          />
        ) : (
          <StaticCounter key={counter.label} counter={counter} />
        )
      )}
    </div>
  )
}
