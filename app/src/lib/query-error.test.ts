import { describe, expect, it } from 'vitest'
import { readQueryError } from '@/lib/query-error'

// The exact shape a ClickHouse failure reaches the editor in, from a filter of
// `captured_at >= 2026` on a DateTime64 column.
const CLICKHOUSE_RAW =
  '{ "meta": [ ], "data": [ ], "rows": 0, "exception": "Code: 41. DB::Exception: Cannot parse DateTime: while converting \'2026\' to DateTime64(3, \'UTC\'). (CANNOT_PARSE_DATETIME) (version 25.7.5.34 (official build))" }'

describe('readQueryError', () => {
  it('pulls the exception out of a ClickHouse response object', () => {
    const { message } = readQueryError(new Error(CLICKHOUSE_RAW))

    expect(message).toBe(
      "Cannot parse DateTime: while converting '2026' to DateTime64(3, 'UTC'). (CANNOT_PARSE_DATETIME)"
    )
  })

  it('keeps the original, since the code and version are what a bug report needs', () => {
    const { detail } = readQueryError(new Error(CLICKHOUSE_RAW))

    expect(detail).toBe(CLICKHOUSE_RAW)
    expect(detail).toContain('Code: 41')
    expect(detail).toContain('version 25.7.5.34')
  })

  it('reads the field even when the payload is not strict JSON', () => {
    // ClickHouse puts newlines inside its exception strings, which is enough to
    // fail JSON.parse.
    const raw = '{ "exception": "Code: 62. DB::Exception: Syntax error:\nfailed at position 8" }'

    expect(readQueryError(raw).message).toBe('Syntax error:\nfailed at position 8')
  })

  it('leaves a message it cannot improve exactly as it is', () => {
    const plain = 'Query execution timed out'

    expect(readQueryError(new Error(plain))).toEqual({ message: plain, detail: null })
  })

  it('takes the message off an error object that is not an Error', () => {
    expect(readQueryError({ message: 'Connection refused' }).message).toBe('Connection refused')
  })

  it('always has something to say', () => {
    expect(readQueryError(null).message).toBe('The query failed to run.')
    expect(readQueryError(new Error('')).message).toBe('The query failed to run.')
  })
})
