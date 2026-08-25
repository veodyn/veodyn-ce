/**
 * Adding a name the schema tree was clicked on to the end of a SQL buffer.
 *
 * The tree's one action used to be a bare string concatenation, so clicking a
 * table with the caret after `... LIMIT 50` produced
 * `... LIMIT 50historical.q_regional_demo_environment_current_weather_31`: a
 * silently invalid statement, and one whose damage is easy to miss because the
 * new text looks right on its own.
 *
 * A separator is not always wanted, which is the whole reason this is a
 * function rather than `previous + ' ' + token`. Someone building a qualified
 * name a click at a time, or filling in a function call, does not want a space
 * appearing in the middle of it.
 */

/** Characters a name may follow directly, because a space would break the thing being built. */
const JOINS_DIRECTLY = new Set(['.', '('])

/**
 * Whether the clicked text is a whole query rather than a name: the JSON
 * object a connector's Query Examples lists. One of those is a starter, not a
 * token, and appending it to a buffer that already holds a query produces two
 * objects on two lines, which the runner reports as "Extra data: line 2".
 */
export function isWholeJsonQuery(token: string): boolean {
  const text = token.trim()
  if (!text.startsWith('{')) return false
  try {
    return typeof JSON.parse(text) === 'object'
  } catch {
    return false
  }
}

export function appendSqlToken(buffer: string, token: string): string {
  if (token === '') return buffer
  if (isWholeJsonQuery(token)) return token
  if (buffer === '') return token
  const last = buffer[buffer.length - 1]
  // Already separated: a newline counts, so a click at the start of a fresh
  // line does not get an unwanted leading space.
  if (/\s/.test(last)) return buffer + token
  if (JOINS_DIRECTLY.has(last)) return buffer + token
  return `${buffer} ${token}`
}
