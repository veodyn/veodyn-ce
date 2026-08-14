# Validated Feed Publishing (pre-publish gate + source attribution)

**Date:** 2026-08-13
**Status:** Design, revision 3, pending review
**Parent spec:** `veodyn/docs/superpowers/specs/2026-06-12-longtail-adapters-validation-design.md` §6 (the three gates)
**Companion:** `veodyn/research/compliance-checker-landscape.md` (build-vs-integrate)

Revision 3 restructures the design around the deployment model. Revision 2
solved hub-tier problems inside a node-tier system without noticing the tier
boundary; this revision puts each mechanism at the tier where its problem
actually exists. See §13 for the revision history.

---

## 1. Why this exists

An operator combines data from multiple sources, declares that a query
publishes a standard feed (GTFS-RT VehiclePositions, TripUpdates,
ServiceAlerts), and gets a published, continuously validated endpoint. When
validation fails, the operator sees **which contributing source caused it**.

The parent spec designed the gates: validate on ingest, validate before
publish and block on ERROR, monitor continuously. What it did not design is
the user-facing binding that says a query *is* a standard feed, where each
gate physically runs in this codebase, and attribution.

## 2. The deployment model, and the shape of the design

The published architecture (veodyn.com/architecture, reconciled with the docs
2026-08-11) has two scales:

- **A node** sits inside one agency's network, pulls that agency's upstream
  sources through connectors, normalizes, and warehouses. Today's real system
  is one node (RIITS) pulling ~13 providers, most of which speak no standard:
  traffic cameras, incident APIs, a metro websocket. One agency context, one
  schedule.
- **A hub** aggregates across nodes. Federation is the next build. There is no
  node-to-node path; everything routes through the hub.

**The design's spine: a node's pre-publish gate is the hub's ingest gate.**
The validated published feed is the federation contract. A hub ingests the
standard feeds its member nodes publish, and everything hard about
multi-agency validation (colliding identifiers, per-agency schedules,
excluding one agency from a regional feed) lives at the hub, where "source"
means node. The same validation model runs at both scales; only what "source"
refers to changes.

This resolves what made revision 2 strained: it required per-source static
GTFS references and identifier namespacing for a system whose real sources
are TrafficLand and Waze, which have no static GTFS and no GTFS identifiers.
Those mechanisms were correct, but they are hub-tier mechanisms.

## 3. Scope and phasing

**Built now (node tier):** the output binding, the three validation
placements of §6, attribution by join, publication state and serving,
`block` and `last_good`, authorization.

**Specified now, built with federation (hub tier):** §8 in full. It is kept
in this document because the node-tier contract (what a published feed
carries) must be designed to be consumable by it.

**Specified concretely:** GTFS-RT VehiclePositions, TripUpdates,
ServiceAlerts. **Slots:** GBFS, TMDD, NTCIP. Same binding shape, same result
schema.

**Non-goals:** writing conformance rules (parent spec §6.1: integrate the
Apache-2.0 validators); static GTFS publishing; the merged regional static
feed (§8.4 names it as the hub's escalation path); the continuous monitor of
*our own published* endpoints (parent spec gate 3), which §6.2's upstream
monitor must not be confused with.

| Phase | Contents |
|---|---|
| **P1** | binding + bind-time validation, VehiclePositions serializer, gate 2 with the integrated validator, publication state machine, endpoint, `block` |
| **P2** | gates 1a/1b wired to verdict storage, attribution by join, Feed Health surfacing, `last_good` with its required cap |
| **P3** | TripUpdates + ServiceAlerts (`entity_binding` design pass, §9), alerting |
| **Federation** | §8, as part of the hub build |

Attribution moves to P2 not because it is deferred design (revision 2's
mistake) but because at node tier it is a join of verdicts, and gate 2 must
exist before there is anything to join.

## 4. Verified ground truth

Read in the tree on 2026-08-13.

- **There is no outbound publish path.** `node/redash/handlers/query_results.py`
  serves json, csv, tsv, xlsx (lines 378 to 395). `api/veodyn_api/` contains
  no reference to gtfs; `app/src/` has three, all comments about the
  `gtfs_realtime` runner's config form.
- **The sidecar runs no worker in a community deployment**
  (`docs/docs/architecture.md:117`, `api/README.md:30`); `veodyn_api.worker`
  ships in the enterprise pack. It **does** have a service-account mode for
  callerless work (`architecture.md:115`).
- **Discovering a query's columns costs a whole result body.**
  `query_result_columns` in `api/veodyn_api/services/ai_grounding.py:200` is
  the house pattern; `()` means "could not find out".
- **Feed Health covers lateness only.** `api/veodyn_api/schemas/feed.py:54`
  is `Literal["fresh", "stale"]`, and `FeedOut` documents itself as one
  inbound capture mapping one-to-one to a dataset.
- **`FeedExpectation` is a storage precedent, not an authorization one.**
  Any org member may set an expectation (`routers/feeds.py:119`) precisely
  because it changes neither data nor permissions. Publishing changes both.
- **The historical capture job may never raise**
  (`historical/tasks.py:20`). Publication does not use that seam and must
  not copy that contract.
- **Connector-level validation exists and discards its evidence.**
  `connector_validation.py` pre-flight checks; `gtfs_realtime.py:43` drops
  entities without positions and line 164 skips unparseable frames with a
  `silent-ok` comment. Gate 1a (§6) is largely a matter of keeping what is
  already computed.
- **A Python static-GTFS validator exists** (`veodyn/gtfs-validator`, PyPI).
  It is an independent reimplementation, not MobilityData's canonical build,
  so adopting it anywhere is a validator-selection decision with an assurance
  tradeoff. Not used in this design.

## 5. The object model (node tier)

```
published_feed
  org_slug, slug             # composite PK; slug is the public URL path
  revision                   # bumped on any change; part of artifact identity
  query_id                   # the query in node
  standard, version, entity  # gtfs-rt 2.0 vehicle_positions
  static_gtfs_ref            # the agency's schedule; ONE, because a node is one agency
  source_column              # OPTIONAL: provenance column, for multi-provider feeds
  column_map                 # spec field -> query column (flat; sufficient for P1, see §9)
  on_error                   # block (default) | last_good
  last_good_max_age          # REQUIRED when on_error = last_good
  visibility                 # private (token) | public
```

Stored in the sidecar's Postgres, org-scoped, beside `FeedExpectation` for
the same storage reason (per-feed operator policy stays out of the pure
derivation in `services/feeds.py`) and explicitly **not** for its
authorization reason (§10).

One static ref, because a node serves one agency. `source_column` is
optional, because at node tier provenance usually identifies a provider, not
an agency, and a single-provider feed has nothing to partition. Both of
these invert at the hub (§8), and the inversion is the tier boundary made
visible.

**Bind-time validation:** declared columns exist in the query's last result,
required spec fields for the entity are mapped, types coercible. Column
discovery via `query_result_columns`; a never-run query binds in state
`unvalidated` and cannot publish until its first result passes the check.
Refusing it outright would make binding order depend on refresh order.

## 6. Where and when validation happens (node tier)

Three placements. Each answers a question the others cannot, and attribution
(§7) is their join.

### 6.1 Gate 1a: at the connector, every capture

The only validation possible for proprietary sources, which is most of them.
There is no spec a TrafficLand or Waze payload conforms to; what exists is
the operational evidence the runners already compute and throw away: entities
dropped and why, frames that failed to parse, payload unchanged since last
poll, entity count collapse against recent history.

Runners record these counters into the capture verdict instead of discarding
them. Per source, per capture, stored beside the capture itself. This is a
small change to `connector_base.py` and the runners, not a rule engine.

Answers: **"provider B's payload degraded."**

### 6.2 Gate 1b: upstream conformance monitor, on cadence

Only for sources that themselves speak a standard (an upstream GBFS system,
another operator's GTFS-RT). The publish worker (§6.4) fetches the upstream
URL directly on a configured cadence and runs the integrated validator
against it, with that upstream's own static ref where the standard requires
one. No runner involvement; it is a URL fetch.

This is the parent spec's continuous monitor pointed at inbound feeds, and it
is the piece the parent spec called the market differentiator.

Answers: **"provider B was already broken before we touched it."**

### 6.3 Gate 2: at publish, every attempt

The node serializes the bound query's result and validates the produced feed
with the **full integrated rule set**, including realtime-to-static matching
against the binding's single static ref. At node tier this is whole-feed
validation; there is no per-source partition, because there is no per-source
schedule to partition against.

Rules requiring a previous feed iteration are supplied with the previous
artifact (it is stored, §6.5). Rules comparing entity types (TripUpdates
against VehiclePositions) are disabled in P1 **explicitly and recorded**,
until binding groups exist. Test coverage claims are scoped to enabled rules.

The 2026-08-13 spike (§6.6) established how the integrated validator actually
consumes both kinds of context, so neither is a guess anymore.

### 6.6 Spike findings: how the integrated validator behaves (2026-08-13)

Measured by running the batch processor (`org.mobilitydata.gtfsrtvalidator`,
1.0.0-SNAPSHOT jar of 2022-02-23) against constructed fixtures with known
defects, and confirmed against `BatchProcessor.java`. These are integration
constraints, not opinions:

- **Findings carry no structured entity reference.** A finding is a rule
  (`errorId`, `severity`, `title`, `errorDescription`, `occurrenceSuffix`)
  plus a list of occurrences whose only locator is a free-text,
  rule-specific `prefix`: `"vehicle_id bus-2 trip_id GHOST"` (E003),
  `"trip_id t2 stop_sequence [2, 1]"` (E002),
  `"header.timestamp of 1786658858"` (E017). Rendering is prefix + suffix
  and is fine as-is; mapping a finding back to a row would need a per-rule
  regex and is not needed by this design (attribution is by run, §7).
- **Iteration comparison is type-blind in batch mode.** `prevMessage` is
  simply the previous file in sort order (default: mtime ascending;
  `-sortBy name` parses a timestamp from the filename). A TripUpdates file
  gets compared against a VehiclePositions file, which produced spurious
  E017s on 3 of 4 fixture files. **The worker must validate each entity in
  its own directory sequence**, feeding only that binding's previous
  artifact, or E017/E018 report nonsense.
- **Cross-entity rules run only on a combined feed.** `combinedMessage` is
  set only when one file contains multiple entity types, and then W003/E047
  fire (confirmed: W003 listed both directions of the TripUpdates against
  VehiclePositions mismatch). So enabling those rules later does not need a
  validator change: a binding group concatenates its entities' artifacts
  into one FeedMessage handed to the validator for validation only.
- **"Now" is the file's timestamp, not the wall clock.** Batch mode judges
  freshness rules (E050 fired this way) against the file's mtime or
  filename-parsed time. The worker therefore controls the clock, which also
  makes freshness rules deterministically testable.
- **Consecutive identical payloads are skipped** by MD5 digest before any
  validation, so an unchanged upstream costs nothing, and the results land
  as `<input>.results.json` beside each input file.
- **The prebuilt jar is a 2022-02-23 snapshot while the repo was last
  pushed 2026-04.** Production integration builds from source in CI rather
  than consuming the stale GitHub Packages artifact; the rule set above was
  additionally checked against the current `RULES.md` (57 rules).

Answers: **"what we are about to publish is (not) conformant."**

### 6.4 The worker, and when each gate runs

The publish loop ships in `veodyn_api.worker` and polls; nothing pushes.
It processes bindings whose query has a newer `latest_query_data_id` than
their current artifact records (gate 2), and runs due upstream monitors
(gate 1b). Gate 1a needs no scheduling; it rides every capture.

Polling preserves the documented service direction (the sidecar calls the
query service, never the reverse), requires no change to node's execution
path, and does not inherit the capture job's never-raise contract.
Publication lags a refresh by up to one poll interval; `FeedHeader.timestamp`
reflects the source result, so the lag is visible to consumers as header
age, which is the honest signal.

### 6.5 Publication state

Per attempt, an artifact identified by `(binding revision, query_result_id)`:
feed bytes, findings, enabled-rule inventory, validator version, decision.

- **Atomic swap.** `current_published` moves by compare-and-swap; an attempt
  whose `query_result_id` is older than the pointer's is discarded, so
  out-of-order completion cannot regress the endpoint.
- **Fail closed.** Validator timeout, malformed response, or outage is a
  failed attempt, never an absent verdict.
- **Revalidation triggers beyond refresh:** binding edit, static ref change,
  validator or serializer version change.
- **Endpoint behavior:** `block` keeps serving the last valid artifact with
  its original header timestamp while the status surface reports the failed
  attempt. `last_good` is the same plus its required age cap, past which the
  endpoint returns 503 with `Retry-After`. `block` never stops serving on
  age alone; an operator who wants hard removal sets a cap.

## 7. Attribution (node tier): a join, not a partition

When gate 2 fails, the operator's question is "whose fault," and the answer
comes from reading the gates together, not from tracing bytes:

| gate 1a/1b state for the feed's sources | gate 2 state | verdict shown |
|---|---|---|
| source B red | red | **source B**: its capture degraded / its upstream fails conformance, with B's own findings attached |
| all green | red | **the node's own pipeline**: normalization, the query, or the binding broke it |
| source B red | green | B degraded but the published output survives; warn, do not block |

The mapping from a published feed to "its sources" is the query's lineage:
which captured tables the bound query reads, which the catalog already knows
(`build_catalog` ties capture tables to queries and data sources). No
validator-message parsing, no entity index, no row partitioning.

Where `source_column` is set (a feed genuinely combining several transit
providers), per-value slice validation as in §8.2 is available as an opt-in
refinement; it is the hub mechanism running early, and it requires per-value
static refs, so it is not the default.

This join is exactly what revision 2 relegated to a footnote ("consuming the
ingest gate"). At node tier it is the whole mechanism, and it is honest about
the two cases an operator acts on differently: call the provider, or fix our
own join.

## 8. The hub tier (specified now, built with federation)

At the hub, "source" means node, and everything revision 2 built applies
with that substitution. A hub binding aggregates the standard feeds its
member nodes publish.

### 8.1 The node registry is the source table

```
hub_feed_source
  hub_slug, node_id
  feed_url                  # the node's published endpoint (§6)
  static_gtfs_ref           # THAT NODE'S agency schedule
  required                  # if true, this node may never be excluded
```

Per-node static refs exist here because the hub spans agencies and GTFS
identifiers are not unique across them; two nodes can both carry trip `100`.

### 8.2 The hub validates per node, then assembled

- **Hub gate 1 = each node's published feed, re-validated** against that
  node's static ref, full rule set. **The hub does not trust the node's own
  verdict**; a compromised or misconfigured node's self-assessment must not
  gate regional publication. The node's verdict travels as metadata for
  diagnosis, so "the node thinks it is clean and the hub disagrees" is
  itself a visible, actionable state.
- **Assembled validation** covers only rules needing no schedule
  (structural, header, feed-wide duplicate ids, ordering). Realtime-to-static
  cannot run over the assembled feed without a merged regional static with
  identifiers rewritten, which is a named escalation, not part of this
  design. The per-node runs are where those rules mean something anyway.
- **Attribution is which run found it.** Same principle as §7, sharper
  partition: findings from node B's run attribute to node B; assembled-run
  findings attribute to the hub feed.

### 8.3 Entities are node-homogeneous

An emitted entity draws from exactly one node; grouping is by
`(node, trip identity)` and emitted ids are namespaced by node, so
cross-agency collisions cannot collapse or collide. A grouping that would
mix nodes is a serialization error, not a published entity.

### 8.4 `exclude_source`, hub only

The mode belongs here because partial regional publication ("seven agencies
keep publishing when the eighth breaks") only means something across nodes.
Its floors, unchanged from revision 2: mandatory re-validation of the
reduced feed with fallback to `block`; one retry, never a loop; never below
`min_sources` and never excluding a `required` node; unattributed
(assembled-run) errors cannot trigger exclusion; exclusion is always
reported.

## 9. The entity binding (P3 gate)

The flat `column_map` suffices for VehiclePositions and not for the P3
entities. The P3 design pass must specify: grouping key, repeated-field
mapping and ordering (`stop_time_update`, `informed_entity`, translations,
active periods), conflict resolution when grouped rows disagree on a parent
field, protobuf presence versus defaults, entity id generation, timestamp
units, null-row handling, deterministic output ordering. That list is the
acceptance criterion for the pass, not something an implementer infers.

## 10. Authorization and surfacing

**Publishing is a distinct permission**, plus proof the creator can read the
bound query. The service account's access is re-checked per attempt; a
binding whose query becomes unreadable stops publishing and reports why.
**Private feeds get a token model**: hash, issuance, rotation, revocation,
audit.

**Feed Health gets a separate model and endpoint** for published feeds, not
optional fields on `FeedOut`, whose one-capture-one-dataset contract would
be destroyed by them. The published-feed view shows the gate verdicts side
by side, which is §7 rendered directly. Wire-shape obligations as ever:
`pnpm gen:api-types` after any response-model change, and `types/feed.ts`
in the same change as any `FeedOut` edit.

**Enterprise boundary:** the worker is enterprise, so publishing is
enterprise at both tiers; the hub tier is commercial by definition (the
federation layer is what the hub buyer pays for). Whether node-tier
publishing should also exist in community, which would require a different
execution home for the worker loop, stays open question 5.

## 11. Testing

- Known-good and known-bad fixtures per entity, scoped to enabled rules; the
  gate catches every known-bad and publishes every known-good.
- **The attribution table test**: three fixtures matching §7's three rows,
  asserting the verdict names the right party and only it. A test that
  merely finds errors would pass with attribution wrong.
- Out-of-order attempts (older `query_result_id` finishing last) do not
  regress the pointer; validator unreachable fails closed.
- Gate 1a: a capture with dropped entities and unparseable frames records
  them; the same capture before this change silently discarded them, so run
  the test with the fix reverted to prove it can fail.
- Hub tier, when built: the identifier-collision fixture (two nodes both
  carrying trip `100`), the node-homogeneity fixture, and the
  `exclude_source` floor fixtures from revision 2 carry over unchanged.

## 12. Open questions

1. **Worker poll interval and gate 1b cadences.**
2. **Rate limiting for public endpoints**, and at which layer.
3. **Should node-tier publishing exist in community?** (§10.)
4. **`capabilities-and-limits.md:34` lists GTFS-RT output as shipped.** It
   is absent from `app/`, `api/`, `node/`. Reconcile or correct.

Former questions 1 and 2 (what identifiers findings carry; which rules need
previous-iteration or companion context) were answered by the 2026-08-13
spike and are recorded as §6.6.

## 13. Revision history

- **r1** put attribution in the serializer via an entity index and carried
  one static ref per feed. Adversarial review rated four findings critical.
- **r2** replaced the index with per-source partition validation and
  per-source static refs, fixing the criticals but importing multi-agency
  machinery into a system whose sources are providers, not agencies.
- **r3** (this) placed the tier boundary: r2's machinery is the hub tier,
  where source = node and the problems it solves actually exist; the node
  tier validates at the connector, the upstream, and the publish gate, and
  attributes by joining them. The recursion (node gate 2 = hub gate 1) is
  the design's spine and the federation contract.
