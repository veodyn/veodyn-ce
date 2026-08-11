// Turning a failed run into something worth reading.
//
// Redash hands back whatever the data source said, verbatim. For ClickHouse
// that is the entire response object, so a mistyped filter used to reach the
// analyst as
//
//   Error: { "meta": [ ], "data": [ ], "rows": 0, "exception": "Code: 41.
//   DB::Exception: Cannot parse DateTime: while converting '2026' to
//   DateTime64(3, 'UTC'). (CANNOT_PARSE_DATETIME) (version 25.7.5.34 (official
//   build))" }
//
// with the one sentence that matters buried in the middle of it. Nothing is
// thrown away: the original is kept alongside for the details disclosure, since
// a version string and an error code are exactly what gets pasted into a bug
// report.

export interface QueryError {
  /** The sentence to show. */
  message: string
  /** The original text, when it says more than `message` does. */
  detail: string | null
}

// "Code: 41. DB::Exception: <what happened> (VERSION ...)": the prefix is for
// the log, the version tail is for the bug report, and neither is the message.
const CLICKHOUSE_PREFIX = /^Code:\s*\d+[.,]?\s*(?:DB::(?:Exception|ErrnoException):\s*)?/i
// The tail nests: "(version 25.7.5.34 (official build))".
const VERSION_TAIL = /\s*\(version [^)]*(?:\([^)]*\)\s*)*\)\s*$/i

// The fields a data source's error object might carry the real message in,
// most specific first.
const MESSAGE_KEYS = ['exception', 'message', 'error', 'detail']

function fromRecord(record: Record<string, unknown>): string | null {
  for (const key of MESSAGE_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

// The payload arrives as text far more often than as an object, and not always
// as strict JSON, so a failed parse falls through to a scan for the field.
function extractEmbedded(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (parsed != null && typeof parsed === 'object') {
      const found = fromRecord(parsed as Record<string, unknown>)
      if (found != null) return found
    }
  } catch {
    // Not valid JSON. ClickHouse embeds newlines in its exception strings,
    // which is enough to break the parse, so the field is read directly.
  }

  for (const key of MESSAGE_KEYS) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`) as string
      } catch {
        return match[1]
      }
    }
  }
  return null
}

function tidy(message: string): string {
  return message.replace(CLICKHOUSE_PREFIX, '').replace(VERSION_TAIL, '').trim()
}

/**
 * The message to show for a failed run, and the raw text behind it.
 *
 * Anything unrecognised is passed through untouched: a message this cannot
 * improve is still the only thing the analyst has.
 */
export function readQueryError(error: unknown): QueryError {
  const raw =
    error == null
      ? ''
      : typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === 'object'
            ? (fromRecord(error as Record<string, unknown>) ?? String(error))
            : String(error)

  const text = raw.trim()
  if (text === '') return { message: 'The query failed to run.', detail: null }

  const embedded = extractEmbedded(text)
  const message = tidy(embedded ?? text)
  if (message === '') return { message: text, detail: null }
  return { message, detail: message === text ? null : text }
}
