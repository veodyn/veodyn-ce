// What this has to get right is not "parse SQL". It is "know when you cannot".
// A wrong column list would tell an analyst their correct column is wrong,
// which is worse than the mismatch it exists to catch, so most of these cases
// are about returning null rather than about returning names.
import { describe, expect, it } from 'vitest'
import { reconcileValueColumn, sqlOutputColumns } from './sql-output-columns'

describe('sqlOutputColumns', () => {
  it('reads the alias the AI actually wrote', () => {
    // The statement from the report: the card said `vehicle_count` while the
    // SQL beside it said `distinct_vehicle_count`.
    expect(
      sqlOutputColumns(
        'SELECT count(DISTINCT vehicle_id) AS distinct_vehicle_count FROM historical.vehicles'
      )
    ).toEqual(['distinct_vehicle_count'])
  })

  it('reads several columns, aliased and bare', () => {
    expect(sqlOutputColumns('SELECT day, sum(riders) AS total FROM t GROUP BY day')).toEqual([
      'day',
      'total',
    ])
  })

  it('drops the qualifier from a bare table.column', () => {
    expect(sqlOutputColumns('SELECT t.station FROM stations t')).toEqual(['station'])
  })

  it('is not fooled by a comma inside a function call', () => {
    expect(
      sqlOutputColumns("SELECT toStartOfInterval(ts, INTERVAL 1 DAY) AS bucket, count() AS n FROM t")
    ).toEqual(['bucket', 'n'])
  })

  it('is not fooled by a comma inside a string literal', () => {
    expect(sqlOutputColumns("SELECT concat(a, ', ', b) AS label FROM t")).toEqual(['label'])
  })

  it('ignores a FROM that belongs to a subquery in the select list', () => {
    expect(
      sqlOutputColumns('SELECT (SELECT max(v) FROM other) AS peak, name FROM t')
    ).toEqual(['peak', 'name'])
  })

  it('reads a statement with no FROM at all', () => {
    expect(sqlOutputColumns('SELECT now() AS as_of')).toEqual(['as_of'])
  })

  it('ignores a line comment that mentions a column', () => {
    expect(sqlOutputColumns('-- returns riders\nSELECT sum(r) AS riders FROM t')).toEqual([
      'riders',
    ])
  })

  it('keeps a quoted alias without its quotes', () => {
    expect(sqlOutputColumns('SELECT count() AS "row count" FROM t')).toEqual(['row count'])
  })

  describe('says it does not know, rather than guessing', () => {
    it('on a star, which stands for any number of columns', () => {
      expect(sqlOutputColumns('SELECT * FROM t')).toBeNull()
      expect(sqlOutputColumns('SELECT t.*, 1 AS one FROM t')).toBeNull()
    })

    it('on a CTE, where the final columns are not the first SELECT', () => {
      expect(
        sqlOutputColumns('WITH base AS (SELECT a FROM t) SELECT count() AS n FROM base')
      ).toBeNull()
    })

    it('on a set operation, where two select lists meet', () => {
      expect(sqlOutputColumns('SELECT a FROM t UNION ALL SELECT b FROM u')).toBeNull()
    })

    it('on an implicit alias, which cannot be told from a trailing keyword', () => {
      // `x IS NOT NULL` would come back as a column called NULL.
      expect(sqlOutputColumns('SELECT a + b total FROM t')).toBeNull()
      expect(sqlOutputColumns('SELECT a IS NOT NULL FROM t')).toBeNull()
    })

    it('on unbalanced parentheses', () => {
      expect(sqlOutputColumns('SELECT count(a AS n FROM t')).toBeNull()
    })

    it('on something that is not a SELECT', () => {
      expect(sqlOutputColumns('INSERT INTO t VALUES (1)')).toBeNull()
    })
  })
})

describe('reconcileValueColumn', () => {
  it('keeps the model’s column when the SQL really produces it', () => {
    expect(reconcileValueColumn('riders', ['day', 'riders'])).toEqual({
      column: 'riders',
      corrected: false,
    })
  })

  it('corrects to the only column there is', () => {
    expect(reconcileValueColumn('vehicle_count', ['distinct_vehicle_count'])).toEqual({
      column: 'distinct_vehicle_count',
      corrected: true,
    })
  })

  it('refuses to choose between several, and leaves the field as it was', () => {
    // Picking one here would be the same class of mistake as the mismatch: an
    // answer asserted rather than known. The card shows what the SQL returns
    // and the analyst decides.
    expect(reconcileValueColumn('vehicle_count', ['day', 'a', 'b'])).toEqual({
      column: 'vehicle_count',
      corrected: false,
    })
  })

  it('leaves the field alone when the SQL could not be read', () => {
    expect(reconcileValueColumn('vehicle_count', null)).toEqual({
      column: 'vehicle_count',
      corrected: false,
    })
  })
})
