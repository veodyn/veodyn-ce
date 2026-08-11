import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mockConverse, mockGenerateSql } from './ai-mock'
import { AppError } from '@/lib/errorIds'
import { isCommunityProposal } from '@/components/ai/create-chat/proposals/proposal-model'
import { mockQueries, mockSchema } from '@/lib/mock-data'
import type { GenerateSqlRequest } from '@/types/ai'
import type { AnyProposal, ConverseMessage, CreateKind, Proposal } from '@/types/ai-create'
import { MAX_MESSAGE_CHARS } from '@/types/ai-create'

/**
 * Narrow a scripted proposal to a kind this module can name.
 *
 * The script's proposals are typed as the open wire type, because two of the
 * five kinds belong to installed features and this module cannot name their
 * shapes. For the three community kinds the narrowing is real; the KPI and
 * report cases below read their fields off the opaque payload instead.
 */
function community(proposal: AnyProposal | null): Proposal {
  if (proposal == null || !isCommunityProposal(proposal)) {
    throw new Error(`expected a community proposal, got ${proposal?.kind ?? 'nothing'}`)
  }
  return proposal
}

const req: GenerateSqlRequest = {
  prompt: 'daily boardings by route',
  dataset: {
    table: 'bus_ridership_daily',
    columns: [
      { name: 'service_date', type: 'date' },
      { name: 'route_id', type: 'string' },
      { name: 'boardings', type: 'integer' },
    ],
  },
}

describe('mockGenerateSql (deterministic)', () => {
  it('returns SQL that references the dataset table and a rationale', () => {
    const out = mockGenerateSql(req)
    expect(out.sql).toContain('bus_ridership_daily')
    expect(out.sql.toUpperCase()).toContain('SELECT')
    expect(out.rationale.length).toBeGreaterThan(0)
  })

  it('is deterministic for the same input', () => {
    expect(mockGenerateSql(req).sql).toBe(mockGenerateSql(req).sql)
    expect(mockGenerateSql(req)).toEqual(mockGenerateSql(req))
  })

  it('groups the first non-numeric column by the first numeric one', () => {
    expect(mockGenerateSql(req).sql).toBe(
      [
        'SELECT service_date, sum(boardings) AS boardings_total',
        'FROM bus_ridership_daily',
        'GROUP BY service_date',
        'ORDER BY boardings_total DESC',
        'LIMIT 100',
      ].join('\n')
    )
  })

  it('omits GROUP BY and ORDER BY when the grounding has no usable columns', () => {
    const sql = mockGenerateSql({ prompt: 'anything', dataset: { table: 'trips', columns: [] } }).sql
    expect(sql).toBe('SELECT *\nFROM trips\nLIMIT 100')
  })

  it('handles a dimension-only and a measure-only grounding', () => {
    const dimOnly = mockGenerateSql({ prompt: 'p', dataset: { table: 't', columns: [{ name: 'route_id', type: 'string' }] } }).sql
    expect(dimOnly).toBe('SELECT route_id\nFROM t\nORDER BY route_id\nLIMIT 100')
    const measureOnly = mockGenerateSql({ prompt: 'p', dataset: { table: 't', columns: [{ name: 'boardings', type: 'integer' }] } }).sql
    expect(measureOnly).toBe('SELECT sum(boardings) AS boardings_total\nFROM t\nLIMIT 100')
  })
})

describe('mockGenerateSql grounding safety', () => {
  it('refuses a table name that is not a plain identifier', () => {
    for (const table of ['t; DROP TABLE users', "t'", 't --', '']) {
      expect(() => mockGenerateSql({ prompt: 'p', dataset: { table, columns: [] } })).toThrow(AppError)
    }
  })

  it('drops column names that are not plain identifiers instead of emitting them', () => {
    const out = mockGenerateSql({
      prompt: 'p',
      dataset: {
        table: 'trips',
        columns: [
          { name: "route_id'; DROP TABLE users; --", type: 'string' },
          { name: 'boardings) FROM x; --', type: 'integer' },
          { name: 'route_id', type: 'string' },
        ],
      },
    })
    expect(out.sql).not.toContain('DROP')
    expect(out.sql).not.toContain('--')
    expect(out.sql).toContain('SELECT route_id')
  })

  it('never interpolates the prompt into the SQL, only into the rationale', () => {
    const out = mockGenerateSql({ ...req, prompt: "'; DROP TABLE users; --" })
    expect(out.sql).not.toContain('DROP')
    expect(out.rationale).toContain('DROP')
  })

  // Both halves of the mock, since the conversation fixtures moved into their
  // own module: a clock in the script would be just as nondeterministic there.
  it.each(['src/lib/ai-mock.ts', 'src/lib/ai-mock-script.ts'])(
    'uses no nondeterministic source in %s (no Math.random, no Date.now)',
    (path) => {
      const source = readFileSync(join(process.cwd(), path), 'utf8')
      const code = source.replace(/^\s*\/\/.*$/gm, '')
      expect(code).not.toMatch(/Math\.random|Date\.now|new Date\(/)
    }
  )
})

const KINDS: CreateKind[] = ['query', 'dashboard', 'kpi', 'report', 'snippet']

/** A transcript of `userTurns` user messages, the assistant replying between them. */
function transcript(userTurns: number): ConverseMessage[] {
  return Array.from({ length: userTurns * 2 - 1 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}`,
  }))
}

describe('mockConverse (scripted, deterministic)', () => {
  it.each(KINDS)('asks one follow-up before proposing anything for %s', (kind) => {
    const turn = mockConverse({ kind, messages: transcript(1) })

    expect(turn.ready).toBe(false)
    expect(turn.proposal).toBeNull()
    expect(turn.reply.length).toBeGreaterThan(0)
    expect(turn.suggestedAnswers.length).toBeGreaterThan(0)
    // The relay's response schema caps the chip row at four.
    expect(turn.suggestedAnswers.length).toBeLessThanOrEqual(4)
  })

  it.each(KINDS)('proposes the kind that was asked for on the next turn: %s', (kind) => {
    const turn = mockConverse({ kind, messages: transcript(2) })

    expect(turn.ready).toBe(true)
    // Not just "a proposal": the wrong kind would render the wrong card and
    // commit through the wrong hook.
    expect(turn.proposal?.kind).toBe(kind)
  })

  it('counts user turns, not messages', () => {
    // An assistant reply is not a turn. Counting messages.length would make
    // this second case ready, and the interview would end without an answer.
    const oneTurn: ConverseMessage[] = [{ role: 'user', content: 'a query please' }]
    const answered: ConverseMessage[] = [
      ...oneTurn,
      { role: 'assistant', content: 'which dataset?' },
    ]

    expect(mockConverse({ kind: 'query', messages: oneTurn }).ready).toBe(false)
    expect(mockConverse({ kind: 'query', messages: answered }).ready).toBe(false)
    expect(
      mockConverse({
        kind: 'query',
        messages: [...answered, { role: 'user', content: 'the first one' }],
      }).ready
    ).toBe(true)
  })

  it('is deterministic for the same transcript', () => {
    const payload = { kind: 'kpi' as const, messages: transcript(2) }
    expect(mockConverse(payload)).toEqual(mockConverse(payload))
  })

  it('quotes the goal back within a bounded reply', () => {
    const goal = 'x'.repeat(MAX_MESSAGE_CHARS)
    const turn = mockConverse({ kind: 'query', messages: [{ role: 'user', content: goal }] })

    expect(turn.reply).toContain('xxx')
    // A reply that echoed the whole turn would be as long as the turn itself.
    expect(turn.reply.length).toBeLessThan(500)
  })

  it('never lets the user text reach the proposed SQL', () => {
    const hostile = "'; DROP TABLE users; --"
    const turn = mockConverse({
      kind: 'query',
      messages: [
        { role: 'user', content: hostile },
        { role: 'assistant', content: 'which dataset?' },
        { role: 'user', content: hostile },
      ],
    })

    expect(turn.proposal?.kind).toBe('query')
    expect(JSON.stringify(turn.proposal)).not.toContain('DROP')
  })
})

describe('mockConverse grounding: every id it proposes exists', () => {
  const schemaTables = Object.values(mockSchema).flat()

  it('proposes a query over a table the mock schema actually has', () => {
    const proposal = community(mockConverse({ kind: 'query', messages: transcript(2) }).proposal)
    if (proposal.kind !== 'query') throw new Error('expected a query proposal')

    expect(schemaTables.map((t) => t.name)).toContain(proposal.datasetTable)
    expect(proposal.sql).toContain(`FROM ${proposal.datasetTable}`)
  })

  it('proposes widgets whose visualization belongs to the widget query', () => {
    const proposal = community(
      mockConverse({ kind: 'dashboard', messages: transcript(2) }).proposal
    )
    if (proposal.kind !== 'dashboard') throw new Error('expected a dashboard proposal')

    expect(proposal.widgets.length).toBeGreaterThan(0)
    const assembled = proposal.widgets.filter((widget) => widget.queryId != null)
    const written = proposal.widgets.filter((widget) => widget.newQuery != null)
    // Both kinds of panel are in the fixture, so neither half of the card goes
    // unexercised by the mock the demo runs on.
    expect(assembled.length).toBeGreaterThan(0)
    expect(written.length).toBeGreaterThan(0)

    for (const widget of assembled) {
      const query = mockQueries.find((q) => q.id === widget.queryId)
      expect(query).toBeDefined()
      // A visualization id from some OTHER query is a create that half lands.
      expect(query?.visualizations.map((v) => v.id)).toContain(widget.visualizationId)
    }
    for (const widget of written) {
      // Nothing to look up: the query does not exist yet. What has to be there
      // is what the card will write with, and no id pointing at anything.
      expect(widget.queryId).toBeNull()
      expect(widget.visualizationId).toBeNull()
      expect(widget.newQuery?.sql.length).toBeGreaterThan(0)
      expect(widget.newQuery?.datasetTable.length).toBeGreaterThan(0)
    }
  })

  // The KPI and report scripts stay here, because the SCRIPT is community: a
  // build with no KPI feature still holds the conversation and still has to
  // ground it in queries that exist. What that build lacks is the card, which
  // is why the fields below are read off the opaque payload rather than through
  // KpiProposal and ReportProposal: naming those types here is exactly the
  // import that would make this module need the feature.
  it('proposes a KPI sourced from a query that exists', () => {
    const proposal = mockConverse({ kind: 'kpi', messages: transcript(2) }).proposal
    if (proposal?.kind !== 'kpi') throw new Error('expected a KPI proposal')

    expect(mockQueries.map((q) => q.id)).toContain(proposal.sourceQueryId)
    expect(String(proposal.valueColumn).length).toBeGreaterThan(0)
  })

  it('proposes report sections sourced from queries that exist', () => {
    const proposal = mockConverse({ kind: 'report', messages: transcript(2) }).proposal
    if (proposal?.kind !== 'report') throw new Error('expected a report proposal')

    const outline = proposal.outline as { sections: { sourceQueryId: number | null }[] }
    const sourced = outline.sections.filter((s) => s.sourceQueryId !== null)
    expect(sourced.length).toBeGreaterThan(0)
    for (const section of sourced) {
      expect(mockQueries.map((q) => q.id)).toContain(section.sourceQueryId)
    }
  })

  it('proposes a snippet trigger that does not collide with a seeded one', async () => {
    const { mockQuerySnippets } = await import('@/lib/mock-data')
    const proposal = mockConverse({ kind: 'snippet', messages: transcript(2) }).proposal
    if (proposal?.kind !== 'snippet') throw new Error('expected a snippet proposal')

    expect(mockQuerySnippets.map((s) => s.trigger)).not.toContain(proposal.trigger)
  })
})
