// The 129 paths the enterprise pack owns: the whole of what "enterprise" means
// to this repository, path by path.
//
// It was the move list for scripts/check-ce-build.mjs, a ratchet that moved
// every entry aside, regenerated an empty feature registry and type-checked
// what was left. That check reached zero and then EE-3 Task 6c carried the move
// out for real, so the list stopped describing a rehearsal and became a
// statement about this tree: none of these paths is here any more, and none of
// them may come back. scripts/check-ce-tree.mjs is what enforces that.
//
// Two readers, and neither re-lists a path:
//   - scripts/check-ce-tree.mjs fails if any entry exists in this tree.
//   - src/features/enterprise-route-links.test.ts derives its URL prefixes from
//     the src/app/ entries, so a community module linking to /kpis fails there
//     even though a URL is a string that no type-check can see.
//
// The annotations below are kept as written. Each one records why a path is on
// this side of the line, and several record why a NEIGHBOURING path is not
// (src/lib/richtext.ts, src/lib/public-links.ts, src/stores/mock-data-store.ts).
// Those are the corrections four separate audits made to a list that started as
// a glob, and they are the part of this file worth reading before adding an
// entry or arguing one away.
export const ENTERPRISE_PATHS = [
  // Feature packages, route directories, and their components: the original
  // 14-path baseline.
  'src/features/reports',
  'src/features/kpis',
  'src/features/alerts',
  'src/features/wall',
  'src/app/reports',
  'src/app/kpis',
  'src/app/alerts',
  'src/app/wall',
  'src/app/present',
  'src/app/admin/shared-links',
  'src/components/reports',
  // Singular, unlike the src/app/kpis route directory it corresponds to.
  'src/components/kpi',
  'src/components/alerts',
  'src/components/wall',

  // Service clients and API route handlers.
  'src/services/kpi',
  'src/services/report',
  // The AI provider client for report generation, outlines, the Home digest
  // and annotation suggestions, added by the EE-3 Task 6e audit. It sits in
  // src/services/ai beside the community client.ts (SQL generation) and
  // converse-client.ts (the Create-with-AI relay), which stay: the directory
  // is shared, only this module is enterprise. Every function on it answers
  // one of the four src/app/api/ai/* route directories already on this list,
  // and after Task 6e the only hook that reaches it is use-report-ai.ts.
  'src/services/ai/report-client.ts',
  'src/services/ai/report-client.test.ts',
  'src/app/api/reports',
  'src/app/api/kpis',
  'src/app/api/public/reports',
  'src/app/api/ai/report',
  'src/app/api/ai/outline',
  'src/app/api/ai/digest',
  'src/app/api/ai/suggest-annotations',
  // The three suites over those four routes, and the shared harness they are
  // driven from. None of it is a module the app ships: the harness
  // dynamic-imports all four handlers above and nothing else, and the suites
  // assert the posture the four share (the disabled gate, the demo mock, the
  // real-mode proxy, caller auth, provider credentials). The harness was
  // already on the ratchet; the suites arrived on it the moment the harness
  // was named here, which is what a test sibling looks like from the mover's
  // side.
  'src/app/api/ai/ai-report-test-harness.ts',
  'src/app/api/ai/report-flow-routes.auth.test.ts',
  'src/app/api/ai/report-flow-routes.provider.test.ts',
  'src/app/api/ai/report-flow-routes.test.ts',
  'src/app/api/admin/shared-links',

  // Hooks.
  'src/hooks/use-alert-subscriptions.mock.test.tsx',
  'src/hooks/use-alert-subscriptions.real.test.tsx',
  'src/hooks/use-alert-subscriptions.ts',
  'src/hooks/use-alerts.ts',
  'src/hooks/use-kpis.fixture-fallback.test.tsx',
  'src/hooks/use-kpis.real.test.tsx',
  'src/hooks/use-kpis.test.tsx',
  'src/hooks/use-kpis.ts',
  // The four AI hooks Task 6e split out of use-ai.ts: report outlines, report
  // blocks, the Home digest and suggested dashboard annotations. Each answers
  // one of the src/app/api/ai/* route directories above, and all four call
  // services/ai/report-client.ts. The community use-ai.ts keeps useAiEnabled,
  // useGenerateSql and useConverse, which is the half whose endpoints a
  // community build ships.
  'src/hooks/use-report-ai.test.tsx',
  'src/hooks/use-report-ai.ts',
  // The three report hooks Task 1 missed, and the reason it missed them: they
  // spell `report` singular, and the glob it widened was `use-reports*`. Every
  // caller of all three is already inside src/app/reports or
  // src/components/reports.
  'src/hooks/use-report-governance.ts',
  'src/hooks/use-report-lifecycle.ts',
  'src/hooks/use-report-refresh.ts',
  'src/hooks/use-reports-document-write.ts',
  'src/hooks/use-reports-real-fixtures.ts',
  'src/hooks/use-reports.concurrency.test.tsx',
  'src/hooks/use-reports.delete.test.tsx',
  'src/hooks/use-reports.edit-lock.test.tsx',
  'src/hooks/use-reports.lifecycle.test.tsx',
  'src/hooks/use-reports.real.test.tsx',
  'src/hooks/use-reports.test.tsx',
  'src/hooks/use-reports.ts',
  'src/hooks/use-reports.unconfigured.test.tsx',
  'src/hooks/use-reports.write-reconcile-deletion.test.tsx',
  'src/hooks/use-reports.write-reconcile.test.tsx',
  'src/hooks/use-reports.write-recovery.test.tsx',
  'src/hooks/use-shared-links.ts',
  // The enterprise half of the tag vocabulary's coverage, split out by EE-3
  // Task 6f. The hook itself is community and stays: it stopped naming
  // `s.kpis` and `s.reports` and reads every collection the store holds, which
  // is all it ever wanted. What cannot survive the split is the assertion that
  // a tag carried only by a KPI or only by a report reaches the vocabulary, so
  // that moved here rather than being dropped.
  'src/hooks/use-tag-vocabulary.enterprise.test.ts',
  // The alerts case of use-mutation-readback.test.tsx. What that suite pins (a
  // mock update resolving with the row as it was BEFORE the write) is a
  // property of the pattern rather than of one hook, so the query case stays in
  // the community file and this is the same case against useUpdateAlert.
  'src/hooks/use-alerts.readback.test.tsx',

  // Types.
  'src/types/ai-report.ts',
  'src/types/kpi.ts',
  'src/types/report.ts',
  'src/types/shared-link.ts',

  // Lib.
  // The Home AI digest's own compute: the href a claim links to and the way a
  // headline is broken into fragments. The widget that renders it is already
  // here (components/home/ai-digest.tsx) and arrives through the home.aiDigest
  // slot, so nothing community reads either function. It is named separately
  // from the widget because it also serves the digest mock in
  // lib/ai-report-mock.ts, which is on this list too.
  'src/lib/ai-digest.test.ts',
  'src/lib/ai-digest.ts',
  'src/lib/ai-report-mock.test.ts',
  'src/lib/ai-report-mock.ts',
  'src/lib/kpi-freshness.test.ts',
  'src/lib/kpi-freshness.ts',
  'src/lib/kpi-id.ts',
  'src/lib/kpi-status.test.ts',
  'src/lib/kpi-status.ts',
  'src/lib/managed-alert.test.ts',
  'src/lib/managed-alert.ts',
  'src/lib/public-report-options.test.ts',
  'src/lib/public-report-options.ts',
  'src/lib/public-report-snapshot.test.ts',
  'src/lib/public-report-snapshot.ts',
  'src/lib/report-block-registry.test.ts',
  'src/lib/report-block-registry.ts',
  'src/lib/report-blocks.positional.test.ts',
  'src/lib/report-blocks.promote.test.ts',
  'src/lib/report-blocks.test.ts',
  'src/lib/report-blocks.ts',
  'src/lib/report-id.test.ts',
  'src/lib/report-id.ts',
  'src/lib/report-lifecycle.fixtures.ts',
  'src/lib/report-lifecycle.governance.test.ts',
  'src/lib/report-lifecycle.grounding.test.ts',
  'src/lib/report-lifecycle.publication.test.ts',
  'src/lib/report-lifecycle.test.ts',
  'src/lib/report-lifecycle.ts',
  'src/lib/report-patch.test.ts',
  'src/lib/report-patch.ts',
  'src/lib/report-publication.test.ts',
  'src/lib/report-publication.ts',
  'src/lib/report-refresh.test.ts',
  'src/lib/report-refresh.ts',
  // src/lib/richtext.ts is deliberately absent, and was on this list until the
  // EE-3 target audit. It was swept in by the `src/lib/report-*` glob, but
  // dashboards parse text boxes with it (dashboard-markdown.ts,
  // textbox-markdown.tsx) and dashboards are community. Reports use it too,
  // which makes it shared infrastructure rather than enterprise. It was renamed
  // off the `report-` prefix so the name stops claiming otherwise.
  'src/lib/report-snapshot.test.ts',
  'src/lib/report-snapshot.ts',

  // The Shared Links console, end to end. Added by the EE-3 Task 6d link
  // audit, which asked which side of the line src/lib/shared-links.ts is on:
  // it builds /reports/<id> hrefs, and src/app/admin/shared-links (already
  // here) is the only page that reaches any of it. The answer is enterprise,
  // and it is enterprise as a whole rather than by half. fromRedash() shapes a
  // dashboard or visualization link and fromReport() shapes a report one, but
  // both exist only for that one console, which the approved CE/EE split moves
  // to the pack because the reports descriptor already owns its nav row. The
  // route handler, the hook, the table, the status vocabulary and the types
  // are a closed island: nothing outside these paths and that page imports any
  // of them (grep src/ for shared-link, and what is left is the nav href in
  // the reports descriptor and three suites asserting it).
  //
  // src/lib/public-links.ts is NOT here and must not be: it mints the
  // dashboard and embed public paths this module calls, and share-dashboard-dialog,
  // embed-dialog and use-dashboards call it too. Public sharing of a dashboard
  // is community; the console that inventories every shared link is not.
  'src/lib/shared-links.ts',
  'src/lib/shared-links.test.ts',
  'src/lib/shared-link-status.ts',
  'src/components/admin/shared-links-table.tsx',

  // Mock fixtures. Added by EE-3 Task 4/5 (the mock contribution seam), which
  // took `mockKpis` and `mockReports` off the substitutable pack surface: they
  // reach the mock store through FeatureDescriptor.mockData now, so the pack's
  // index, packs/active.ts and packs/empty.ts no longer name them and these
  // four modules leave with their features. The suites go too, because they
  // are the ones that read the rows.
  'src/lib/mock-data/kpi-fixtures.ts',
  'src/lib/mock-data/report-fixtures.ts',
  'src/lib/mock-data/packs/neutral/kpis.ts',
  'src/lib/mock-data/packs/neutral/kpis.test.ts',
  'src/lib/mock-data/packs/neutral/reports.ts',
  'src/lib/mock-data/packs/neutral/reports.test.ts',

  // Stores. The mock store itself is NOT here and must not be: it is community,
  // it holds the queries, dashboards, users and the rest, and EE-3 Task 6f took
  // the enterprise slices out of it. What that left behind is these three
  // slices, the helper one of them was split into, and the six suites over
  // them: every case in all six drives `addKpi`, `transitionReport` or a
  // sibling, so they are test siblings of the slices exactly as
  // report-refresh-slice.test.ts already was.
  'src/stores/kpi-slice.ts',
  'src/stores/mock-data-store.governance.test.ts',
  'src/stores/mock-data-store.kpi-alert.test.ts',
  'src/stores/mock-data-store.kpi.test.ts',
  'src/stores/mock-data-store.lifecycle.test.ts',
  'src/stores/mock-data-store.report-writes.test.ts',
  'src/stores/mock-data-store.report.test.ts',
  'src/stores/mock-alert-subscriptions.ts',
  'src/stores/report-refresh-slice.test.ts',
  'src/stores/report-refresh-slice.ts',
  'src/stores/report-slice.ts',
  // The publication list a lifecycle transition leaves behind, split out of
  // report-slice.ts by EE-3 Task 6f when adding the two exports the generated
  // mock-slice module reads pushed that file over the size limit. One caller,
  // and it is in this list.
  'src/stores/report-slice-publications.ts',

  // The AI digest widget on the home page. The whole component is enterprise,
  // not a community one with an enterprise import: Home reaches it through the
  // home.aiDigest slot now, so the suite goes with it.
  'src/components/home/ai-digest.tsx',
  'src/components/home/ai-digest.test.tsx',

  // AI-suggested dashboard annotations. The annotation dialog around it is
  // community and stays: the form, the shared validation rule and the list of
  // existing annotations are all community, and only the panel that drafts
  // suggestions leaves, through the dashboard.annotationSuggest slot.
  'src/components/dashboard/annotation-suggest.tsx',
  'src/components/dashboard/annotation-suggest.test.tsx',
  'src/components/dashboard/annotation-suggest.test-helpers.tsx',

  // Starring a KPI and starring a report, end to end. The Favorites page it
  // ends on is community and keeps its own suites (page, truncation,
  // failed-read); this one is the two enterprise kinds, and the sections it
  // asserts on arrive through the favorites.section slot.
  'src/app/favorites/sidecar-favorites.test.tsx',

  // Promoting a dashboard to a report, end to end. It drives the community
  // dashboard page, but what it asserts is the report the promote action
  // writes, so it goes with the feature; the toolbar keeps a community suite
  // of its own next to it (dashboard-view-actions.test.tsx).
  'src/app/dashboards/[dashboardId]/dashboard-promote.test.tsx',
]
