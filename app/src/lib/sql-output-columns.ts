/**
 * The column names a SELECT will return, read off the statement itself.
 *
 * Why this exists: a KPI proposal is two model calls. One conversation names
 * the value column, a separate generation writes the SQL and picks its own
 * aliases, and nothing upstream makes them agree. Observed on the instance: the
 * SQL said `count(DISTINCT vehicle_id) AS distinct_vehicle_count` while the
 * Value column field said `vehicle_count`, so the first Create failed and the
 * analyst was left to reconcile the AI with itself.
 *
 * The result is used to CHECK and to EXPLAIN, never as the only fact anything
 * is built on. `useWriteProposedQuery` still runs the query and compares the
 * real columns before creating a KPI, so a parse that is wrong here costs a
 * hint, not a broken record.
 *
 * **Fails closed.** Anything it cannot read confidently returns null, which
 * every caller treats as "no opinion" and falls back to the free-text field. A
 * partial answer would be worse than none: a column list missing one entry
 * would tell an analyst their correct column is wrong.
 */

/** Alias forms worth trusting: `expr AS name`, or a bare `name` / `t.name`. */
const AS_ALIAS = /\s+AS\s+("[^"]+"|`[^`]+`|[A-Za-z_][\w$]*)\s*$/i
const BARE_COLUMN = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/

function unquote(name: string): string {
  const first = name[0]
  if ((first === '"' && name.endsWith('"')) || (first === '`' && name.endsWith('`'))) {
    return name.slice(1, -1)
  }
  return name
}

/**
 * Strip comments and string literals, keeping length-preserving placeholders.
 *
 * Blanked rather than removed so every offset still lines up with the original,
 * which is what lets the select list be sliced out of the untouched SQL after
 * the scan located it. A comma inside `'a, b'` must not split an item, and a
 * parenthesis inside a comment must not move the nesting depth.
 */
function blankLiterals(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    const char = sql[i]
    if (char === "'" || char === '"' || char === '`') {
      let j = i + 1
      while (j < sql.length && sql[j] !== char) {
        // Backslash escapes are ClickHouse's own; a doubled quote is standard
        // SQL. Both have to be skipped or the literal appears to end early.
        if (sql[j] === '\\') j += 1
        else if (sql[j] === char && sql[j + 1] === char) j += 1
        j += 1
      }
      const stop = Math.min(j + 1, sql.length)
      // Quoted IDENTIFIERS keep their content, since an alias can be written
      // that way; only single-quoted strings are blanked outright.
      out += char === "'" ? ' '.repeat(stop - i) : sql.slice(i, stop)
      i = stop
      continue
    }
    out += char
    i += 1
  }
  return out
}

/** Split on commas that are not inside parentheses. */
function topLevelParts(list: string, scanned: string): string[] | null {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < scanned.length; i += 1) {
    const char = scanned[i]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i))
      start = i + 1
    }
    if (depth < 0) return null
  }
  if (depth !== 0) return null
  parts.push(list.slice(start))
  return parts
}

export function sqlOutputColumns(sql: string): string[] | null {
  const scanned = blankLiterals(sql)
  const upper = scanned.toUpperCase()

  // A CTE or a set operation means the columns come from somewhere other than
  // the first SELECT, and guessing which is exactly the mistake this is here to
  // prevent. Handed back as unknown.
  if (/(^|[^\w$])WITH([^\w$]|$)/.test(upper)) return null
  if (/(^|[^\w$])UNION|INTERSECT|EXCEPT([^\w$]|$)/.test(upper)) return null

  const select = upper.search(/(^|[^\w$])SELECT([^\w$]|$)/)
  if (select === -1) return null
  const listStart = upper.indexOf('SELECT', select) + 'SELECT'.length

  // The FROM that ends the select list is the first one at depth zero. A FROM
  // inside a subquery in the list sits deeper and must not stop the scan.
  let depth = 0
  let listEnd = -1
  for (let i = listStart; i < scanned.length; i += 1) {
    const char = scanned[i]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (depth === 0 && upper.startsWith('FROM', i) && !/[\w$]/.test(upper[i - 1] ?? ' ')) {
      const after = upper[i + 4] ?? ' '
      if (!/[\w$]/.test(after)) {
        listEnd = i
        break
      }
    }
  }
  // No FROM at all is legal (`SELECT now()`), and the list simply runs to the
  // end of the statement.
  const stop = listEnd === -1 ? scanned.length : listEnd
  const list = sql.slice(listStart, stop)
  const parts = topLevelParts(list, scanned.slice(listStart, stop))
  if (parts == null) return null

  const names: string[] = []
  for (const raw of parts) {
    const item = raw.trim().replace(/;$/, '').trim()
    if (item === '') return null
    // A star could stand for any number of columns, so the list is unknowable.
    if (item.includes('*')) return null
    const aliased = AS_ALIAS.exec(item)
    if (aliased) {
      names.push(unquote(aliased[1]))
      continue
    }
    if (BARE_COLUMN.test(item)) {
      names.push(item.split('.').at(-1) ?? item)
      continue
    }
    if (/^"[^"]+"$/.test(item) || /^`[^`]+`$/.test(item)) {
      names.push(unquote(item))
      continue
    }
    // An expression with no AS. Implicit aliases (`a + b total`) are legal and
    // unreadable without a real parser: `x IS NOT NULL` would come back as a
    // column called NULL. Unknown, rather than wrong.
    return null
  }
  return names.length > 0 ? names : null
}

/**
 * Which of the SQL's columns to read, given what the model said.
 *
 * The model's own name wins whenever the SQL actually produces it. When it does
 * not and the statement returns exactly one column, that column is what the KPI
 * must mean, so it is corrected before the analyst ever sees a failed Create.
 * With several columns and no match there is a real choice to make, and this
 * declines to make it: the field keeps the model's answer and the card says
 * what the SQL returns.
 */
export function reconcileValueColumn(
  named: string,
  columns: string[] | null
): { column: string; corrected: boolean } {
  const wanted = named.trim()
  if (columns == null || columns.length === 0) return { column: wanted, corrected: false }
  if (columns.includes(wanted)) return { column: wanted, corrected: false }
  if (columns.length === 1) return { column: columns[0], corrected: true }
  return { column: wanted, corrected: false }
}
