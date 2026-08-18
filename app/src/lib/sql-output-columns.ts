/**
 * The column names a SELECT will return, read off the statement itself. A KPI
 * proposal is two model calls, and the one that names the value column does not
 * see the aliases the one writing the SQL picks.
 *
 * Used to CHECK and to EXPLAIN only: `useWriteProposedQuery` still runs the
 * query and compares the real columns before creating a KPI.
 *
 * **Fails closed.** Anything it cannot read confidently returns null, which
 * every caller treats as "no opinion". A partial answer would tell an analyst
 * their correct column is wrong.
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
 * Blanked rather than removed so offsets still line up with the original SQL
 * the select list is later sliced out of.
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

  // A CTE or a set operation takes the columns from somewhere other than the
  // first SELECT. Unknown, rather than guessed.
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
    // An expression with no AS. Implicit aliases (`a + b total`) need a real
    // parser: `x IS NOT NULL` would come back as a column called NULL.
    return null
  }
  return names.length > 0 ? names : null
}

/**
 * Which of the SQL's columns to read, given what the model said. The model's
 * name wins when the SQL produces it; a single-column statement with no match
 * is corrected to that column; several columns and no match is left alone.
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
