// What a failed run looks like. The pane used to print `(error as Error).message`
// straight out, and for ClickHouse that message is the entire response object.
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { QueryEditorResults } from './query-editor-results'
import type { QueryResultData } from '@/lib/mock-data'

const CLICKHOUSE_RAW =
  '{ "meta": [ ], "data": [ ], "rows": 0, "exception": "Code: 41. DB::Exception: Cannot parse DateTime: while converting \'2026\' to DateTime64(3, \'UTC\'). (CANNOT_PARSE_DATETIME) (version 25.7.5.34 (official build))" }'

const RESULT: { data: QueryResultData } = {
  data: {
    columns: [{ name: 'n', friendly_name: 'N', type: 'integer' }],
    rows: [{ n: 1 }],
  },
}

describe('QueryEditorResults on a failed run', () => {
  it('shows the sentence the data source meant, not its response object', () => {
    renderWithProviders(
      <QueryEditorResults isExecuting={false} error={new Error(CLICKHOUSE_RAW)} result={null} visualizations={undefined} />
    )

    // The headline is one sentence: no envelope, no error code, no build string.
    const headline = screen.getByText(/^Cannot parse DateTime/)
    expect(headline).toHaveTextContent(
      "Cannot parse DateTime: while converting '2026' to DateTime64(3, 'UTC'). (CANNOT_PARSE_DATETIME)"
    )
    expect(headline.textContent).not.toContain('"meta"')
    expect(headline.textContent).not.toContain('official build')
  })

  it('keeps the raw payload one disclosure away, for the bug report', () => {
    renderWithProviders(
      <QueryEditorResults isExecuting={false} error={new Error(CLICKHOUSE_RAW)} result={null} visualizations={undefined} />
    )

    // Nothing is thrown away: the code and the version are what gets pasted
    // into a bug report, they are just not the message.
    const raw = screen.getByText(CLICKHOUSE_RAW)
    expect(raw.closest('details')).not.toBeNull()
    expect(screen.getByText('What the data source said')).toBeInTheDocument()
  })

  it('marks results left over from an earlier run', () => {
    renderWithProviders(
      <QueryEditorResults isExecuting={false} error={new Error('Query execution failed')} result={RESULT} visualizations={undefined} />
    )

    // The rows below an error are from whatever ran last, and read as the
    // output of the query that just failed.
    expect(screen.getByText('The results below are from an earlier run.')).toBeInTheDocument()
  })

  it('says nothing about earlier runs when there is nothing below', () => {
    renderWithProviders(
      <QueryEditorResults isExecuting={false} error={new Error('Query execution failed')} result={null} visualizations={undefined} />
    )

    expect(screen.queryByText('The results below are from an earlier run.')).not.toBeInTheDocument()
  })

  it('stays out of the way when the run succeeded', () => {
    renderWithProviders(
      <QueryEditorResults isExecuting={false} error={null} result={RESULT} visualizations={undefined} />
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
