import { deriveFeedStatus } from '@/lib/feed-status'
import type { Dataset, DatasetFreshness } from '@/types/catalog'
import type { Feed } from '@/types/feed'

/**
 * A dataset's freshness, judged the same way the Feed Health board judges the
 * feed behind it, so the two screens cannot disagree.
 *
 * The dataset's own `lastUpdatedAt` is what gets aged, not the feed's
 * `lastReceivedAt`: a feed can be delivering while this dataset has stopped
 * being rebuilt from it.
 */
const SEVERITY: Record<Feed['status'], number> = { fresh: 0, stale: 1, down: 2 }

function worst(a: Feed['status'], b: Feed['status']): Feed['status'] {
  return SEVERITY[a] >= SEVERITY[b] ? a : b
}

export function resolveDatasetStatus(
  freshness: DatasetFreshness,
  feeds: Feed[] | undefined,
  now: number = Date.now()
): Feed['status'] {
  const feed = freshness.feedId ? feeds?.find((f) => f.id === freshness.feedId) : undefined
  // No feed to ask means no cadence to judge against, so the declared status is
  // the only thing there is.
  if (!feed) return freshness.status

  // Three claims (derived, feed-declared, dataset-declared) and the worst wins,
  // so an upstream that knows it is down is still believed.
  const derived = deriveFeedStatus({ ...feed, lastReceivedAt: freshness.lastUpdatedAt }, now)
  return worst(worst(derived, feed.status), freshness.status)
}

/**
 * Whether `sql` reads `table`, as a whole identifier.
 *
 * Bounded on both sides, or `..._stations_3` would match `..._stations_32` and
 * put a reader on the wrong dataset. Schema-qualified names still match: the
 * `.` in `historical.q_foo_1` is itself a boundary.
 */
function sqlReadsTable(sql: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(sql)
}

/**
 * The dataset a saved query reads.
 *
 * The edge that makes a freshness verdict reachable from anything built on a
 * query. A dashboard widget is a visualization of a query, and "how old is the
 * data behind this widget" is answered by finding the dataset and asking
 * resolveDatasetStatus above, which is why this lives beside it: one definition
 * of which dataset a query is about, rather than a second one that could drift
 * from the catalog and the Feed Health board.
 *
 * A catalog dataset's id IS its ClickHouse table name
 * (`q_regional_demo_bikeshare_stations_32`) and the saved query names that table
 * in its FROM clause, so matching the id inside the SQL is the actual edge.
 *
 * This started out matching `sampleQueryId` instead, which passed every fixture
 * and resolved NOTHING on the real instance: six queries on 43, 44, 45, 46, 50
 * and 79, six datasets whose sampleQueryIds were 14, 21, 22, 23, 31 and 32, zero
 * overlap. The two ids mean different things. `sampleQueryId` is the query that
 * BUILT the table; the query asked about here is a different one that READS it.
 * The fixtures encoded the edge as a shared query id, so a fixture could never
 * have caught this; only the running instance could.
 *
 * The sampleQueryId match stays as a fallback, because that is what the mock
 * packs express and their dataset ids are slugs that appear in no SQL.
 *
 * Fails closed: a query that resolves to no dataset gets null, so a caller
 * renders exactly what it renders now rather than claiming a freshness nothing
 * supports.
 */
export function datasetForQueryId(
  queryId: number | null | undefined,
  datasets: Dataset[] | undefined,
  /** SQL by query id. Without it only the fixture fallback can match. */
  sqlByQueryId?: Map<number, string>
): Dataset | null {
  if (queryId == null || !datasets) return null

  const sql = sqlByQueryId?.get(queryId)
  if (sql) {
    const read = datasets.find((dataset) => sqlReadsTable(sql, dataset.id))
    if (read) return read
  }

  return datasets.find((dataset) => dataset.sampleQueryId === queryId) ?? null
}
