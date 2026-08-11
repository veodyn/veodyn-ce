import { describe, expect, it } from 'vitest'
import { appendSqlToken } from './sql-insert'

const TABLE = 'historical.q_regional_demo_environment_current_weather_31'

describe('appendSqlToken', () => {
  it('separates a name from a statement that had already ended', () => {
    // The reported case: the caret sat after a complete statement and the click
    // welded the table onto the end of it, silently invalid.
    expect(appendSqlToken('SELECT * FROM t LIMIT 50', TABLE)).toBe(
      `SELECT * FROM t LIMIT 50 ${TABLE}`
    )
  })

  it('adds nothing to an empty buffer', () => {
    expect(appendSqlToken('', TABLE)).toBe(TABLE)
  })

  it('leaves a separator that is already there alone', () => {
    expect(appendSqlToken('SELECT * FROM ', TABLE)).toBe(`SELECT * FROM ${TABLE}`)
  })

  it('treats a newline as a separator, so a fresh line does not gain a space', () => {
    expect(appendSqlToken('SELECT *\nFROM\n', TABLE)).toBe(`SELECT *\nFROM\n${TABLE}`)
  })

  it('joins straight onto a dot, which is a name being built a click at a time', () => {
    expect(appendSqlToken('SELECT * FROM historical.', 'weather')).toBe(
      'SELECT * FROM historical.weather'
    )
  })

  it('joins straight onto an open bracket', () => {
    expect(appendSqlToken('SELECT count(', 'rides')).toBe('SELECT count(rides')
  })

  it('separates after a comma, where a space is what reads correctly', () => {
    expect(appendSqlToken('SELECT a,', 'b')).toBe('SELECT a, b')
  })

  it('changes nothing when there is nothing to add', () => {
    expect(appendSqlToken('SELECT 1', '')).toBe('SELECT 1')
  })
})
