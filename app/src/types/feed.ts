// Feed metadata for the Feed Health board. A feed is an upstream data source
// that populates one or more catalog datasets; a dataset links to its feed via
// freshness.feedId. Status/lastReceivedAt come from the feed metadata, not a
// computed threshold engine (that is the KPI spec).
export interface Feed {
  id: string // matches a dataset's freshness.feedId
  name: string
  source: string
  // The interval the board ages this feed against: a declared expectation when
  // there is one, otherwise the capture query's Redash schedule, otherwise
  // 'not scheduled'. e.g. 'hourly', 'daily', 'every 5 min'.
  cadence: string
  // Which of the three the cadence is. Without it the three were one
  // unexplained string, and a verdict nobody had checked looked exactly like
  // one that had been.
  cadenceSource?: 'declared' | 'schedule' | 'none'
  // Seconds, when an operator has declared one, so the editing control can open
  // on the current value rather than parsing the label back into a number.
  expectedIntervalSeconds?: number | null
  // The derived late-alert, when one is armed. The forward link, and so the
  // authority for "this alert is derived from a feed": the alert's own options
  // carry a feedId label that any Redash user could forge.
  alertId?: number | null
  lastReceivedAt: string // ISO 8601
  status: 'fresh' | 'stale' | 'down'
  datasetCount: number
}
