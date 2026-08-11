// The pure adapter between the query editor's data source schema and the
// grounding an /api/ai/* request carries. No React, no fetch, no model call.
import { isSafeSqlIdentifier } from '@/lib/sql-safety'
import type { AiDataset } from '@/types/ai'
import type { SchemaTable } from '@/lib/mock-data'

const EMPTY_DATASET: AiDataset = { table: '', columns: [] }

// A table name counts as named only when it stands on its own, so `stops` does
// not match `stops_archive` and quietly ground the request on the wrong table.
function isNamedIn(sql: string, table: string): boolean {
  if (table.length === 0) return false
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, 'i').test(sql)
}

/**
 * A catalog, index or system table, which is never what someone means when they
 * ask a question about the data. Judged on the last segment so a schema
 * qualifier does not hide the underscore: `historical._catalog` is metadata,
 * `historical.q_trips_9` is not.
 */
function isMetadataTable(name: string): boolean {
  return name.slice(name.lastIndexOf('.') + 1).startsWith('_')
}

function toDataset(table: SchemaTable): AiDataset {
  return {
    table: table.name,
    columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
  }
}

/**
 * The grounding for a generate-SQL request: one table plus its columns.
 *
 * This used to fall back to `schema[0]` whenever the editor was empty, which is
 * a guess presented to the model as a fact. On the real instance `schema[0]` is
 * `historical._catalog`, the table that lists the other tables, so a new query
 * asking "average temperature for the last 7 days" was told its only table was
 * the catalog and wrote `SELECT table_name FROM historical._catalog WHERE ...`,
 * explaining that "only historical._catalog is accessible directly". The model
 * was not hallucinating. It was repeating what this function told it.
 *
 * Worse, it stuck. `isNamedIn` reads the CURRENT SQL, so once a draft named
 * `_catalog` every later prompt stayed grounded there, and naming the real
 * table in the prompt could not move it, because the prompt is not the SQL. A
 * `count(*)` request came back as a count over the catalog and returned 0 for a
 * table holding 347,839 rows, with nothing to say it had counted the wrong
 * thing.
 *
 * So: the table the SQL names, or the source's single real table, or nothing.
 * Returning nothing is what `sqlGenerationBlockedReason` turns into an ask.
 * Refusing to guess is the whole point; a wrong answer delivered confidently
 * cost more than no answer would have.
 */
export function aiDatasetFromSchema(
  schema: readonly SchemaTable[],
  currentSql: string
): AiDataset {
  const named = schema.find((candidate) => isNamedIn(currentSql, candidate.name))
  if (named) return toDataset(named)

  // Only when there is no choice to get wrong.
  const real = schema.filter((candidate) => !isMetadataTable(candidate.name))
  if (real.length === 1) return toDataset(real[0])

  return EMPTY_DATASET
}

/** The tables a prompt could be grounded on, for saying how many there are. */
export function groundableTables(schema: readonly SchemaTable[]): readonly SchemaTable[] {
  return schema.filter((candidate) => !isMetadataTable(candidate.name))
}


/** What the prompt bar needs to know about the source it would generate for. */
export interface GenerationSource {
  name: string
  syntax?: string | null
}

/**
 * Why SQL generation is off for this source, or null when it is on.
 *
 * Both cases end the same way if they are not caught here: the service is asked
 * to write a statement over a table it cannot express, its validator refuses
 * twice (once per retry), and the browser is told "AI is unavailable right
 * now". That message is wrong on every count. The provider is fine, the request
 * was answered, and what actually happened is that this surface offered SQL for
 * something that does not take SQL.
 *
 * Reported in the same words the Visual builder uses for the same fact, so a
 * source that cannot be run against and one that cannot be generated for read
 * as one limitation rather than two.
 */
export function sqlGenerationBlockedReason(
  source: GenerationSource | null,
  dataset: AiDataset,
  /** The whole schema, so an ungrounded prompt can say what to do about it. */
  schema: readonly SchemaTable[] = []
): string | null {
  if (source != null && source.syntax != null && source.syntax !== 'sql') {
    return `${source.name} takes ${source.syntax}, not SQL, so generation is off here.`
  }
  // Ungrounded with tables to choose from. Naming one costs a click in the
  // schema browser on the left, and the alternative is what this replaces: a
  // guess handed to the model as the only table it has.
  if (dataset.table === '') {
    const count = groundableTables(schema).length
    if (count > 1) {
      return `This source has ${count} tables. Name the one you want in the editor, or click it in the schema browser, and generation turns on.`
    }
    if (count === 0 && schema.length > 0) {
      return 'This source exposes no table SQL can read, so generation is off here.'
    }
  }
  // A SQL source can still expose entries that are not tables: a documentation
  // tree ("1. feeds > params", "__ Query Examples __") browses like a schema
  // and cannot be put in a FROM clause.
  if (dataset.table !== '' && !isSafeSqlIdentifier(dataset.table, 2)) {
    return `${dataset.table} is not a table SQL can read, so generation is off here.`
  }
  return null
}
