// The scripted Create-with-AI conversation (spec section 8): one fixture per
// kind, read by mockConverse in ai-mock.ts.
//
// Split out of ai-mock.ts when the fixtures grew a chart mapping and a focus
// table and the file crossed the size limit. The generator mock stayed there;
// these two share nothing but the identifier helpers.
//
// Every id below is LOOKED UP in the fixtures rather than written down. The
// point of the mock conversation is that a demo user can press Create at the
// end of it, and a proposal naming a query, a visualization or a table that no
// pack ships would fail at exactly that step. Both fixture packs are read
// through the same selection `@/lib/mock-data` makes, so this holds for either.
//
// Deterministic, like the generator: no Math.random, no clock, no ambient state.
import { mockQueries, mockQueryResults, mockSchema } from '@/lib/mock-data'
import type { MockQuery, MockVisualization } from '@/lib/mock-data'
import type { AnyProposal, CreateKind } from '@/types/ai-create'
import { isDateSqlType, isNumericSqlType, isSafeSqlIdentifier } from './sql-safety'

const ROW_LIMIT = 100

/** The chart a widget should show, falling back to whatever the query has. */
function preferredViz(query: MockQuery): MockVisualization | undefined {
  return query.visualizations.find((v) => v.type === 'CHART') ?? query.visualizations[0]
}

const groundedWidgets = mockQueries
  .flatMap((query) => {
    const viz = preferredViz(query)
    return viz ? [{ query, viz }] : []
  })
  .slice(0, 2)

const primaryQuery: MockQuery | undefined = groundedWidgets[0]?.query ?? mockQueries[0]
const secondaryQuery: MockQuery | undefined = groundedWidgets[1]?.query ?? primaryQuery

// The KPI's value column has to be a column of the source query's RESULT, not
// of the underlying table: that is what the evaluator reads.
const primaryResultColumns =
  mockQueryResults[primaryQuery?.latest_query_data_id ?? -1]?.data.columns ?? []
const valueColumn = primaryResultColumns.find((c) => isNumericSqlType(c.type))?.name ?? 'value'

// A table from the mock ClickHouse schema, so the proposed query reads
// something the mock catalog can actually show. The fallbacks keep this module
// total (an import-time throw would take the whole route down); ai-mock.test.ts
// asserts the fixtures make them unreachable.
const groundedTable = Object.values(mockSchema)[0]?.[0]
const groundedTableName =
  groundedTable && isSafeSqlIdentifier(groundedTable.name, 1) ? groundedTable.name : 'events'
const groundedDimension = (groundedTable?.columns ?? []).find(
  (c) => isSafeSqlIdentifier(c.name, 1) && !isNumericSqlType(c.type) && !isDateSqlType(c.type)
)?.name

const groundedSql = [
  groundedDimension ? `SELECT ${groundedDimension}, count() AS row_count` : 'SELECT count() AS row_count',
  `FROM ${groundedTableName}`,
  ...(groundedDimension ? [`GROUP BY ${groundedDimension}`, 'ORDER BY row_count DESC'] : []),
  `LIMIT ${ROW_LIMIT}`,
].join('\n')

// The mapping the service authors from a statement's real result columns, for
// the statement above: the dimension on x, the count on y. Written down so mock
// mode creates a MAPPED chart rather than one that leans on the renderer's
// column-order fallback, which is what makes the create-chat e2e cover the merge
// with the shape the analyst picks on the card.
const groundedColumnMapping: Record<string, string> = {
  ...(groundedDimension ? { [groundedDimension]: 'x' } : {}),
  row_count: 'y',
}

export interface KindScript {
  /** The one follow-up the mock interview asks before it proposes anything. */
  question: string
  suggestedAnswers: string[]
  readyReply: string
  proposal: AnyProposal
  /**
   * What the mock says it profiled, which the client hands back on the next
   * turn. A mock profiles nothing, so this is the table the script's own SQL
   * reads, and null for the kinds whose script has no statement of its own.
   */
  focusTable: string | null
}

export const CONVERSE_SCRIPT: Record<CreateKind, KindScript> = {
  query: {
    question: 'Which dataset should this read, and over what period?',
    suggestedAnswers: ['Last 30 days', 'Last 7 days', 'All time'],
    readyReply: `Here is a query over ${groundedTableName}. The SQL is not editable here: ask for a change, or edit it once the query opens.`,
    focusTable: groundedTableName,
    proposal: {
      kind: 'query',
      name: `${groundedTableName} by ${groundedDimension ?? 'total'}`,
      description: `Draft query over ${groundedTableName}. Review the SQL before trusting the result.`,
      sql: groundedSql,
      datasetTable: groundedTableName,
      // An id from VIZ_CHOICES (src/lib/viz-choices.ts), written down rather
      // than imported: that module pulls in React thumbnail components and this
      // one is loaded by a route handler.
      vizChoiceId: 'chart-line',
      vizOptions: { columnMapping: groundedColumnMapping },
    },
  },
  dashboard: {
    question: 'What should this dashboard show?',
    suggestedAnswers: ['The ones I look at most', 'Anything about operations'],
    readyReply:
      'This brings together queries that already exist and writes one for the gap. Open a panel to read its SQL, and remove any you do not want.',
    focusTable: null,
    proposal: {
      kind: 'dashboard',
      name: 'Operations overview',
      widgets: [
        ...groundedWidgets.map(({ query, viz }) => ({
          title: query.name,
          queryId: query.id,
          visualizationId: viz.id,
          vizChoiceId: null,
          newQuery: null,
        })),
        // One written panel, so the fixture exercises the half of the card that
        // creates a query rather than only the half that points at one.
        {
          title: 'Rows per hour',
          queryId: null,
          visualizationId: null,
          vizChoiceId: null,
          newQuery: {
            name: 'Rows per hour',
            description: 'How many rows arrived in each hour of the last day.',
            sql: 'SELECT toStartOfHour(timestamp) AS hour, count() AS rows\nFROM events\nGROUP BY hour\nORDER BY hour',
            datasetTable: 'events',
            vizChoiceId: 'chart-bar',
            vizOptions: { columnMapping: { hour: 'x', rows: 'y' } },
          },
        },
      ],
    },
  },
  kpi: {
    question: 'What should this KPI measure, and what counts as good?',
    suggestedAnswers: ['Higher is better', 'Lower is better', 'Check it daily'],
    readyReply: `This reads ${valueColumn} from an existing query. Check the column and the target before creating it.`,
    focusTable: null,
    proposal: {
      kind: 'kpi',
      name: `${valueColumn} trend`,
      description: `Tracks ${valueColumn} from "${primaryQuery?.name ?? 'an existing query'}".`,
      sourceQueryId: primaryQuery?.id ?? 0,
      // The common case, and kept that way deliberately. A KPI over a query that
      // exists is what most requests land on, and switching the fixture to the
      // written branch would change what every KPI test reading this script is
      // checking, including the browser walkthrough that ships with the KPI
      // feature. The written branch has its own suite there; the report script
      // below is the one that exercises a written query end to end in mock mode.
      newQuery: null,
      valueColumn,
      unit: null,
      target: 100,
      direction: 'higher-is-better',
      cadence: 'daily',
      atRisk: null,
      breached: null,
    },
  },
  report: {
    question: 'Who reads this report, and what decision does it support?',
    suggestedAnswers: ['A weekly operations review', 'An executive summary'],
    readyReply:
      'Here is the outline. Two sections read queries you already have, one writes a query for the gap. Rename the sections or drop the suggested one, then create it as a draft.',
    focusTable: groundedTableName,
    proposal: {
      kind: 'report',
      outline: {
        goal: 'Weekly operations review',
        sections: [
          {
            id: 'overview',
            title: 'Overview',
            intent: 'Headline trend',
            sourceQueryId: primaryQuery?.id ?? null,
            newQuery: null,
            suggested: false,
            enabled: true,
          },
          {
            id: 'breakdown',
            title: 'Breakdown',
            intent: 'Segment detail',
            sourceQueryId: secondaryQuery?.id ?? null,
            newQuery: null,
            suggested: false,
            enabled: true,
          },
          {
            // The written section. This one used to carry no source at all, which
            // is exactly the case that used to become prose whether the reader
            // wanted a number there or not, so it is the one worth exercising:
            // mock mode now runs the write-then-draft path end to end.
            id: 'volume',
            title: 'Volume by category',
            intent: 'How much arrived in each category',
            sourceQueryId: null,
            newQuery: {
              name: `${groundedTableName} by ${groundedDimension ?? 'total'}`,
              description: `Draft query over ${groundedTableName}. Review the SQL before trusting the result.`,
              // The same grounded statement the query script proposes, so there
              // is one fixture SQL and it reads a table the mock catalog has.
              sql: groundedSql,
              datasetTable: groundedTableName,
              vizChoiceId: 'chart-bar',
              vizOptions: { columnMapping: groundedColumnMapping },
            },
            suggested: false,
            enabled: true,
          },
          {
            id: 'context',
            title: 'Context and caveats',
            intent: 'Suggested extra: data caveats',
            sourceQueryId: null,
            newQuery: null,
            suggested: true,
            enabled: false,
          },
        ],
      },
    },
  },
  snippet: {
    question: 'What should the snippet insert, and what word should trigger it?',
    suggestedAnswers: ['A date filter', 'A pagination clause'],
    readyReply: 'Here is the snippet. Change the trigger word if it clashes with one you already use.',
    focusTable: null,
    proposal: {
      kind: 'snippet',
      trigger: 'last30d',
      snippet: 'WHERE timestamp >= now() - INTERVAL 30 DAY',
      description: 'Filter for the last 30 days',
    },
  },
}
