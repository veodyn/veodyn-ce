// When SQL generation does not apply to the data source in front of you.
//
// The bar used to offer it for every source and ground on whatever the schema
// tree listed first. A GBFS source browses as API documentation ("1. feeds >
// params", "__ Query Examples __"), so the request named a table no statement
// can put in a FROM clause, the service's validator refused it twice, and the
// 502 that came back was rendered as "AI is unavailable right now", which was
// wrong about the provider, the request, and what the analyst should do next.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { renderWithProviders } from '@/test/utils'
import { QueryAiPromptBar } from './query-ai-authoring'
import { sqlGenerationBlockedReason } from './query-ai-model'
import type { MockDataSource } from '@/lib/mock-data'

const DOCS_TREE = [
  { name: '1. feeds > params', columns: [{ name: '(no params)', type: 'String' }] },
  { name: '2. station_information > returns', columns: [{ name: 'station_id', type: 'String' }] },
]

const TABLES = [{ name: 'historical.stations', columns: [{ name: 'lat', type: 'Float64' }] }]

function source(over: Partial<MockDataSource> = {}): MockDataSource {
  return {
    id: 1,
    name: 'Regional GBFS Bikeshare',
    type: 'json',
    syntax: 'json',
    paused: 0,
    pause_reason: null,
    options: {},
    groups: {},
    created_at: '',
    view_only: false,
    ...over,
  }
}

describe('sqlGenerationBlockedReason', () => {
  it('blocks a source that does not take SQL, and says what it takes', () => {
    const reason = sqlGenerationBlockedReason(source(), { table: 'anything', columns: [] })

    expect(reason).toContain('takes json, not SQL')
    expect(reason).toContain('Regional GBFS Bikeshare')
  })

  it('blocks a schema entry that is documentation rather than a table', () => {
    // The second guard, for a SQL source whose tree still carries entries no
    // FROM clause can name.
    const reason = sqlGenerationBlockedReason(source({ syntax: 'sql' }), {
      table: '1. feeds > params',
      columns: [],
    })

    expect(reason).toContain('not a table SQL can read')
  })

  it('allows a SQL source with a real table', () => {
    expect(
      sqlGenerationBlockedReason(source({ syntax: 'sql' }), {
        table: 'historical.stations',
        columns: [],
      })
    ).toBeNull()
  })

  it('allows a source whose syntax is not known yet', () => {
    // A backend that did not say. Refusing on absence would switch the feature
    // off for everyone the moment the field went missing, which is the failure
    // mode this whole fix exists to avoid.
    expect(
      sqlGenerationBlockedReason(
        { name: 'Unknown', syntax: undefined },
        { table: 'historical.stations', columns: [] }
      )
    ).toBeNull()
    expect(
      sqlGenerationBlockedReason(
        { name: 'Unknown', syntax: null },
        { table: 'historical.stations', columns: [] }
      )
    ).toBeNull()
  })

  it('allows an empty grounding, which is a data source still loading', () => {
    expect(sqlGenerationBlockedReason(null, { table: '', columns: [] })).toBeNull()
  })
})

function renderBar(dataSource: MockDataSource | null, schema = DOCS_TREE) {
  renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: true } }}>
      <QueryAiPromptBar
        schema={schema}
        currentSql=""
        onGenerated={vi.fn()}
        dataSource={dataSource}
      />
    </ConfigProvider>
  )
}

describe('the prompt bar on a source it cannot generate for', () => {
  it('says why, and takes no prompt', async () => {
    renderBar(source())

    const input = await screen.findByRole('textbox', { name: 'Generate SQL with AI' })
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: /Generate draft/ })).toBeDisabled()
    // A status, not an alert: nothing failed.
    expect(screen.getByRole('status')).toHaveTextContent(/takes json, not SQL/)
    expect(screen.queryByText(/AI is unavailable/)).not.toBeInTheDocument()
  })

  it('is a working bar again on a SQL source with real tables', async () => {
    renderBar(source({ syntax: 'sql', name: 'DE Historical' }), TABLES)

    expect(await screen.findByRole('textbox', { name: 'Generate SQL with AI' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
