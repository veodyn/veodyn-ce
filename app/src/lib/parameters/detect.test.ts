/**
 * Parameters are authored by writing `{{ name }}` in the SQL, which is how
 * Redash does it (services/query.js `parseQuery` / `updateParameters`). A name
 * in the text and not in options.parameters becomes a new text parameter; a
 * parameter whose name has left the text is dropped; everything else keeps the
 * settings it already had.
 */
import { describe, expect, it } from 'vitest'
import type { MockQueryParameter } from '@/lib/mock-data'
import { detectParameterNames, syncParameters } from './detect'

describe('detectParameterNames', () => {
  it('finds a parameter and ignores the surrounding SQL', () => {
    expect(detectParameterNames('SELECT * FROM trips WHERE route = {{ route_id }}')).toEqual([
      'route_id',
    ])
  })

  it('does not care about whitespace inside the braces', () => {
    expect(detectParameterNames('{{route}} {{  other  }}')).toEqual(['route', 'other'])
  })

  // A range parameter is referenced as two fields of one parameter, so both
  // mentions describe the same thing to configure.
  it('collapses a dotted reference to the parameter it belongs to', () => {
    expect(
      detectParameterNames('WHERE t BETWEEN {{ window.start }} AND {{ window.end }}')
    ).toEqual(['window'])
  })

  it('reports each name once, in the order it first appears', () => {
    expect(detectParameterNames('{{ b }} {{ a }} {{ b }}')).toEqual(['b', 'a'])
  })

  it('reads the unescaped form too', () => {
    expect(detectParameterNames('{{& raw_thing }}')).toEqual(['raw_thing'])
  })

  // Mustache control tags are not parameters. A closing tag especially: pairing
  // it with its opener would offer the same parameter twice.
  it('ignores comments, partials and section closers', () => {
    expect(detectParameterNames('{{! a note }} {{> partial }} {{/ section }}')).toEqual([])
  })

  // The backend counts a section key as a parameter it requires
  // (_collect_key_names in models/parameterized_query.py), so the UI has to
  // offer it or the query is refused for a value nothing can supply.
  it('treats a section opener as a parameter, the way the backend does', () => {
    expect(detectParameterNames('{{# has_route }} AND route = 1 {{/ has_route }}')).toEqual([
      'has_route',
    ])
  })

  it('finds nothing in SQL without parameters', () => {
    expect(detectParameterNames('SELECT 1')).toEqual([])
  })

  it('is not confused by a single brace or an unclosed tag', () => {
    expect(detectParameterNames('SELECT {json_col} FROM t WHERE x = {{ open')).toEqual([])
  })
})

describe('syncParameters', () => {
  const existing: MockQueryParameter[] = [
    { name: 'route_id', title: 'Route', type: 'enum', value: '12', enumOptions: '12\n40' },
  ]

  it('keeps a parameter that is still referenced, with its settings intact', () => {
    expect(syncParameters(existing, ['route_id'])).toEqual(existing)
  })

  // The settings are the whole point of the dialog. Rebuilding the parameter
  // from the name alone on every keystroke would throw them away.
  it('does not reset settings when other parameters change around it', () => {
    const next = syncParameters(existing, ['route_id', 'day'])

    expect(next[0]).toEqual(existing[0])
  })

  it('adds a newly referenced name as a plain text parameter', () => {
    const next = syncParameters([], ['day'])

    expect(next).toEqual([{ name: 'day', title: 'day', type: 'text', value: null }])
  })

  it('drops a parameter whose name has left the SQL', () => {
    expect(syncParameters(existing, [])).toEqual([])
  })

  // New ones go last rather than in SQL order, so configuring a parameter does
  // not reshuffle the bar every time the query above it is edited.
  it('appends new parameters after the ones already there', () => {
    const next = syncParameters(existing, ['day', 'route_id'])

    expect(next.map((p) => p.name)).toEqual(['route_id', 'day'])
  })

  // Referential stability matters: the editor compares this against what was
  // saved to decide whether there is anything to write.
  it('returns the same array contents when nothing changed', () => {
    expect(syncParameters(existing, ['route_id'])).toEqual(existing)
    expect(syncParameters([], [])).toEqual([])
  })
})
