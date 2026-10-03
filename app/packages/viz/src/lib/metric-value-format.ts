// One rule for writing a measured value with its unit, so the number in the
// tile, the numbers in the definition list and the number in a sparkline
// tooltip all read the same way. There were two copies of this before, and a
// third was about to be written for the tooltip.
//
// The rule itself mirrors StatNumber's suffix handling: percent hugs the digits
// because "82 %" is not how anyone writes it, and every other unit is a word
// after a space.
//
// It was called formatKpiValue, in components/kpi, until the EE-3 Task 6e
// target audit found the KPI_HISTORY visualization reaching into the KPI
// feature for it. Nothing in it is about a KPI: it takes a number and a unit string. A
// build with no KPI feature still draws that visualization, so the rule is
// community and the name no longer claims otherwise.
export function formatMetricValue(value: number, unit?: string | null): string {
  if (!unit) return value.toLocaleString()
  return unit === '%' ? `${value.toLocaleString()}%` : `${value.toLocaleString()} ${unit}`
}
