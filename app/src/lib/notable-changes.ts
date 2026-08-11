// Pure compute for the Home notable-changes strip: which dataset was refreshed
// most recently and which least. No React, no I/O - the component
// (src/components/home/notable-changes-strip.tsx) reads the data hooks and
// passes their results through this.
//
// The movers and the recent breaches used to sit here too, and moved to
// components/kpi/notable-changes.ts in the EE-3 Task 6e split. This is the half
// a build with no KPI and no alerts feature can still honestly compute, which
// is why the community fallback keeps a Freshness section and loses the other
// two. There is no re-export of the other half from here: a shim would keep the
// old CE-build ratchet green while leaving the coupling exactly where it was.
import type { Dataset } from '@/types/catalog'

export function computeFreshestStalest(datasets: Dataset[]): {
  freshest: Dataset | null
  stalest: Dataset | null
} {
  if (datasets.length === 0) {
    return { freshest: null, stalest: null }
  }

  let freshest = datasets[0]
  let stalest = datasets[0]

  for (const dataset of datasets.slice(1)) {
    if (Date.parse(dataset.freshness.lastUpdatedAt) > Date.parse(freshest.freshness.lastUpdatedAt)) {
      freshest = dataset
    }
    if (Date.parse(dataset.freshness.lastUpdatedAt) < Date.parse(stalest.freshness.lastUpdatedAt)) {
      stalest = dataset
    }
  }

  return { freshest, stalest }
}
