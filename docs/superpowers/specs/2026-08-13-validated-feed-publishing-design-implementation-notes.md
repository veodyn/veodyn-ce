# Implementation notes: validated feed publishing, P1

Working notes for the P1 build against
`2026-08-13-validated-feed-publishing-design.md`. Decisions where the spec was
ambiguous, deliberate deviations, and open questions for the developer. Not
permanent documentation.

## Where the spec was ambiguous, and what was decided

**An edit takes the feed off the air.** The spec says a binding edit bumps the
revision so an old-mapping artifact "can never be mistaken for a current one",
but never says whether the old artifact keeps *serving* while the new revision
has not published yet. `block`'s stated behaviour (keep serving the last valid
artifact) pointed one way; the model's own docstring pointed the other. Decided:
clear the pointer on any accepted edit, and on delete. The reasoning is in
`_take_the_feed_off_the_air`. The deciding argument was asymmetry of failure:
going dark is loud and visible to the admin who just made the edit and is undone
by the next successful attempt, while serving an artifact against a retired
declaration is indistinguishable from a healthy feed at the endpoint.

It clears **unconditionally**, not only for fields that affect bytes. A
"material fields" list has to be extended by hand as fields land, and forgetting
to fails in the silent direction.

**Revision scoping is split in two.** The served pointer is per feed, any
revision, because that is what the partial unique index covers and what a
publish must clear. The staleness guard and the previous-feed hand-off are
per revision, because comparing `query_result_id` across lineages is
meaningless after a repoint, and handing the validator a previous iteration
built from a different column map makes its iteration rules answer a question
nobody asked. Two lookups, named apart, rather than one overloaded one.

**`unvalidated` bindings save rather than being refused.** Refusing a binding
for a query that has never run would make binding order depend on refresh
order. It saves and cannot publish until a result proves the map.

## Deliberate deviations from the spec

**`exclude_source` is not built.** The spec assigns it to the hub tier, and P1
is node tier. `on_error` therefore accepts `block` and `last_good` only.

**`last_good` is stored and constrained but has no behaviour.** Behaviour
belongs to the serving endpoint, which P1 does not build. The CHECK constraint
exists now so no binding can be created that the serving endpoint would later
have to guess about.

**No worker, no serving endpoint.** Both are enterprise-pack surfaces
(`api/README.md:30`: a community deployment runs no worker). `run_attempt` is a
plain function precisely so the pack can drive it without this tree owning a
queue.

## Things the build discovered that the spec did not anticipate

- **A community model must be imported in `veodyn_api/models/__init__.py`.**
  `migrations/env.py` reaches `target_metadata` through that module alone, so a
  model missing from it is invisible to autogenerate on the metadata side while
  `include_name` still reflects its table, and the sweep proposes dropping the
  table the chain just created. A test module importing the model directly masks
  this, because collection populates the metadata as a side effect.
- **SQLAlchemy hoists an autoincrement column to the front of a composite
  primary key.** `publish_attempt`'s metadata built `(attempt_id, org_slug,
  slug)` while the migration built `(org_slug, slug, attempt_id)`. Same
  constraint name, different index, and only the migration's is tenant-prefixed.
  Autogenerate does not compare PK column order, so nothing reported it. Pinned
  with an explicit `PrimaryKeyConstraint`.
- **`Boolean("is_current")` as an index predicate is not a weak index, it is a
  broken table.** `Boolean` is a type; SQLAlchemy rejects it at DDL time, so
  `create_all` fails in fixture setup.
- **`query_result_columns` collapses every failure into `()`.** Its docstring is
  explicit that `()` means "could not find out", with a rationale written for
  its first caller: "A KPI proposal is not worth refusing over a Redash hiccup."
  For the binding router the right answer is the opposite, so the router proves
  the query exists and is readable separately rather than inferring it from an
  empty column list.
- **`protobuf` 32-bit float fields store `1e39` as infinity.** Valid bytes,
  invalid GTFS-RT.

## Open questions for the developer

1. **There is no foreign key from `publish_attempt` to `published_feed`.**
   Deleting a binding leaves its attempts with `is_current` set, so recreating
   the slug would inherit the deleted feed's bytes. The router closes this by
   clearing the pointer on delete and is currently the only delete path, so the
   hole is shut, but by one call site rather than by the schema. A cascading
   foreign key would make it structural. Deferred, and it is the serving
   endpoint that would be embarrassed by getting it wrong.

2. **Is node-tier publishing meant to be enterprise-only?** It is today, because
   the worker is, and the worker ships in the pack. The hub tier is commercial
   by definition; the node tier being commercial too is a product call this
   build made on a technical constraint.

3. **Which rules did the validator actually run?** `enabled_rules` is recorded
   per attempt and the engine refuses a verdict from zero rules, but nothing yet
   asserts that a particular expected rule set was enabled. A feed could pass
   because the rules that would have failed it were not switched on.

4. **`last_good_max_age_seconds` has no default.** It is required when the mode
   is `last_good`, which is right, but nothing suggests a sensible value. The
   spec parks this too (open question 3 there).
