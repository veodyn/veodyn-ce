import { describe, expectTypeOf, it } from 'vitest'
import type { components } from './veodyn-api'
import type {
  ConverseResponse,
  DashboardProposal,
  QueryProposal,
  SnippetProposal,
} from '@/types/ai-create'

// `veodyn-api.d.ts` is generated from the service's own OpenAPI schema by
// `pnpm gen:api-types`, so it is the backend's actual response shape rather
// than a second hand-written copy of it. These assertions fail at tsc time if
// the Python service drops, renames or retypes a field the app reads, instead
// of the app finding an undefined at runtime with the fixtures masking it.
//
// Regenerate after any change to a veodyn_api schema module. If an assertion
// then fails, the two halves genuinely disagree: fix the side that is wrong,
// do not relax the assertion.
//
// WHERE THE KPI AND REPORT ASSERTIONS WENT. They are in the enterprise pack, in
// its app overlay, indexing a declaration generated from that pack's own
// composed OpenAPI schema.
//
// They went uncompiled for a while, and this paragraph used to say so. That is
// closed: the pack's pipeline now has a second job on a node image which
// assembles its overlay onto a checkout of this repository and runs
// `tsc --noEmit` over the composed tree, and the assertions ship at that tree's
// `src/types/generated/`, so nothing had to be added to this tsconfig for them.
// The pack also still runs `tests/test_contract_artifact.py`, which holds its
// declaration to its `openapi.json` field by field, and which catches the
// staleness a tsc cannot see.
//
// `KpiOut`, `KpiEvaluationOut`,
// `KpiHistoryPointOut`, `KpiSourceOut`, `KpiTargetOut`, `KpiThresholdsOut`,
// `ReportOut` and `KpiCreate` are not keys of `components['schemas']` here any
// more, because the endpoints that publish them are not in the community
// service. Indexing one is a tsc error rather than a silently absent assertion.
//
// This note exists because the gap it describes has already been found once the
// hard way: reports had no assertion in this file at all for a while, and the
// suite passed while proving nothing about the report contract. The next person
// to wonder why reports have no assertion here should find this paragraph
// rather than repeat that.
//
// THESE ASSERTIONS ARE CHECKED BY `tsc --noEmit`, NOT BY VITEST. expectTypeOf
// compiles away to nothing at runtime, so `vitest run` here passes whatever the
// types say. `vitest run --typecheck` does not help either: typecheck.include
// defaults to `**/*.test-d.ts` and this file is `.test.ts`, so vitest collects
// zero typecheck files and prints "Type Errors: no errors" having checked none.
// Verified on 2026-07-29 by renaming ReportOut.ownerId in the generated file:
// vitest still reported 16 passed and no type errors, tsc named the field.
// Trust `pnpm exec tsc --noEmit` (and the `next build` CI runs) for this file.
describe('veodyn-api contract', () => {
  // The Create-with-AI conversation. This matters more than the KPI half: the
  // relay's Zod schema for converse is strict, so a field renamed or retyped in
  // veodyn_api/schemas/ai.py does not degrade, it turns every turn into a 502.
  // These assertions fail at tsc time instead, naming the field.
  it('ConverseOut satisfies the app-facing ConverseResponse', () => {
    expectTypeOf<components['schemas']['ConverseOut']>().toExtend<ConverseResponse>()
  })

  // One assertion per kind, so a break names the card that would stop
  // rendering rather than pointing at the union.
  it('QueryProposalOut satisfies the query card', () => {
    expectTypeOf<components['schemas']['QueryProposalOut']>().toExtend<QueryProposal>()
  })

  it('DashboardProposalOut satisfies the dashboard card', () => {
    expectTypeOf<components['schemas']['DashboardProposalOut']>().toExtend<DashboardProposal>()
  })

  // `KpiProposalOut` and `ReportProposalOut` are asserted in
  // components/kpi/kpi-proposal.contract.test.ts and
  // components/reports/report-proposal.contract.test.ts, beside the cards that
  // read them. The SCHEMAS are still community (a converse turn can converge on
  // a proposed KPI on a build with no endpoint to create one), but `KpiProposal`
  // and `ReportProposal` are stated in KPI and report terms, so an assertion
  // naming them cannot compile without those features. Same file, same
  // expectTypeOf, one directory over.
  it('SnippetProposalOut satisfies the snippet card', () => {
    expectTypeOf<components['schemas']['SnippetProposalOut']>().toExtend<SnippetProposal>()
  })

  // toExtend permits the service to ADD a field, which for every other route
  // here is a harmless extra key the relay strips. Converse is the exception:
  // its Zod schema is strict, so an added field is not a tolerated difference,
  // it is a 502 on every turn. Key-set equality is what catches that, and it
  // catches it here rather than in production.
  it('the converse turn has exactly the keys both halves agree on', () => {
    expectTypeOf<keyof ConverseResponse>().toEqualTypeOf<
      keyof components['schemas']['ConverseOut']
    >()
  })

  it('each proposal has exactly the keys both halves agree on', () => {
    expectTypeOf<keyof QueryProposal>().toEqualTypeOf<
      keyof components['schemas']['QueryProposalOut']
    >()
    expectTypeOf<keyof DashboardProposal>().toEqualTypeOf<
      keyof components['schemas']['DashboardProposalOut']
    >()
    // The KPI and report key-set assertions moved with their types; see above.
    expectTypeOf<keyof SnippetProposal>().toEqualTypeOf<
      keyof components['schemas']['SnippetProposalOut']
    >()
  })

  // `KpiProposalOut` and `ReportProposalOut` above are NOT the KPI and report
  // response shapes and did not move. They come from `schemas/ai_create.py`,
  // which is community: a converse turn can converge on a proposed KPI or report
  // on a build that has no endpoint to create one. Removing them with the rest
  // would have deleted a live assertion.
  //
  // The write shapes travel the other way: what the app sends must be something
  // the service accepts, so the assertion is reversed. The only one left here is
  // in the pack, for the same reason `KpiCreate` is.
})
