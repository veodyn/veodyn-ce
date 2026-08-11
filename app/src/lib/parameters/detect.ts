/**
 * Finding the parameters a query declares, by reading its SQL.
 *
 * This is how a parameter gets created in the first place: you write
 * `{{ route_id }}` and it appears. Redash does the same in services/query.js
 * (`parseQuery` collects mustache keys, `updateParameters` reconciles them
 * against options.parameters).
 *
 * A regex rather than a mustache parser, because the whole grammar is not
 * needed here: what matters is the set of keys, and an unparseable template
 * must not throw away the parameters already configured.
 */
import type { MockQueryParameter } from '@/lib/mock-data'

/** `{{ anything }}`, non-greedy so two tags on one line stay separate. */
const TAG = /\{\{([^{}]*?)\}\}/g

/**
 * Mustache tags that are not parameters. A closing tag is excluded on purpose:
 * pairing it with its opener would offer the same parameter twice. A section
 * opener IS included, because the backend counts a section key among the
 * parameters it requires (`_collect_key_names`), and a query refused for a
 * value the UI never offered is the worst version of this.
 */
const NOT_A_PARAMETER = ['/', '!', '>', '=', '^']

export function detectParameterNames(sql: string): string[] {
  const names: string[] = []

  for (const match of sql.matchAll(TAG)) {
    let key = match[1].trim()
    if (!key) continue
    if (NOT_A_PARAMETER.includes(key[0])) continue
    // `&` is the unescaped form and `#` opens a section; both name a parameter.
    if (key[0] === '&' || key[0] === '#') key = key.slice(1).trim()
    // `window.start` and `window.end` are two references to one parameter.
    const name = key.split('.')[0].trim()
    if (!name || names.includes(name)) continue
    names.push(name)
  }

  return names
}

/**
 * Reconciles the saved parameter definitions against the names the SQL now
 * references. Existing definitions keep their settings and their order; a name
 * with no definition becomes a plain text parameter; a definition whose name is
 * gone from the SQL is dropped.
 *
 * New ones are appended rather than inserted in SQL order, so configuring a
 * parameter does not reshuffle the bar whenever the query above it is edited.
 */
export function syncParameters(
  existing: MockQueryParameter[],
  names: string[]
): MockQueryParameter[] {
  const kept = existing.filter((p) => names.includes(p.name))
  const added = names
    .filter((name) => !existing.some((p) => p.name === name))
    .map<MockQueryParameter>((name) => ({ name, title: name, type: 'text', value: null }))

  return [...kept, ...added]
}
