# Published feed UI: design

Revision 1, 2026-08-14.

The product surface for validated feed publishing. The P1 API landed with no
frontend at all, so a binding can be created only by calling the sidecar
directly. This design says where that surface lives, what an operator does with
it, and the two small API additions it needs to be honest.

Companion to `2026-08-13-validated-feed-publishing-design.md`, which owns the
mechanism. Where the two disagree, that one wins on behaviour and this one wins
on presentation.

## 1. Scope

In: the binding list, the create and edit form, the detail page with attempt
history, and an on-demand publish action.

Out: the serving endpoint (enterprise, `veodyn_api.routers.public`), the worker
(enterprise), gate 1a/1b verdict surfacing and attribution (P2 in the mechanism
design, §3), TripUpdates and ServiceAlerts (P3).

## 2. Verified ground truth

Read in the tree on 2026-08-14, at `d768845f`.

**The API answers four questions and no more.**
`api/veodyn_api/routers/published_feeds.py` exposes list, create, get, update
and delete over `/published-feeds`. Writes require an administrator
(`_require_admin`, line 42); reads are open to any org member, deliberately, on
the reasoning that publishing changes data exposure and permissions while
reading a declaration does not.

**Attempts are stored and exposed by nothing.** `publish_attempt` holds the
decision, the reason, the findings, the enabled-rule inventory, the served
pointer and the bytes (`models/publish_attempt.py`). No route reads that table.
So without an addition, the app cannot answer "is this feed serving", which is
the first question anyone opening the page will have.

**Every P1 module is community.** `api/tests/ce_module_allowlist.json` lists
`models/published_feed.py`, `models/publish_attempt.py`,
`routers/published_feeds.py`, `schemas/published_feed.py`,
`services/feed_validator.py`, `services/gtfs_rt_serializer.py` and
`services/publish_engine.py` under `retained`. Only `routers.public` is in
`moved`. The UI therefore belongs in core `app/`, not behind the feature-slot
seam, and the two additions in §4 stay community too.

**A community deployment publishes nothing.** `api/README.md:30` states the
community edition runs no worker and no queue consumer. So in a community build
a saved binding is inert unless something drives `run_attempt` from a request.
The plan anticipated this: `run_attempt` is a plain function specifically so a
caller can drive it without this tree owning a queue
(`docs/superpowers/plans/2026-08-13-validated-feed-publishing-p1.md:2107`).

**The mapping vocabulary is a closed set of eight.**
`services/gtfs_rt_serializer.py:28-40`: `vehicle_id`, `latitude`, `longitude`
required; `bearing`, `speed`, `trip_id`, `route_id`, `timestamp` supported. A
key outside that set is refused at bind time and again at publish time.

**`standard`, `version` and `entity` each have exactly one legal value today**
(`schemas/published_feed.py:32-39`). They are facts to state in the form, not
dropdowns with one option.

**The browser can already reach a query's result columns** through the existing
`/api/redash/[...path]` passthrough, via the query's `latest_query_data_id`.
No new backend read is needed to populate a column picker.

**The IA has a place for this and a name collision to avoid.**
`app/src/lib/sidebar-nav.ts` puts APIs and MCP under CONNECT (line 155) and Feed
Health under MONITOR (line 147). `/feed-health` means inbound capture freshness,
which the mechanism design explicitly warns must not be confused with our own
published endpoints (§2). Note also that `NavSectionId` is
`'library' | 'monitor' | 'admin'` (`app/src/features/types.ts:8`), so CONNECT
takes no feature-contributed rows; a core row is the only way in.

## 3. The surface

| Route | Who | What |
|---|---|---|
| `/connect/feeds` | any org member | the list |
| `/connect/feeds/new` | admin | the grouped form |
| `/connect/feeds/[slug]` | any org member | binding, serving status, attempt history |
| `/connect/feeds/[slug]/edit` | admin | the same form, prefilled |

One nav row appended to the CONNECT section. It is **not** gated on admin,
because the API serves the list to any org member and hiding a page whose data
everyone may fetch would be a lie told only to the sidebar. Non-admins get the
pages without the actions, as §6.5 sets out.

Proxy handlers under `app/src/app/api/published-feeds/`, following
`app/src/app/api/feeds/route.ts`: server-side config, the caller's identity
forwarded, and 422 bodies passed through intact rather than collapsed into a
status code, since the refusal messages are the whole diagnostic.

`Rss` is the natural icon and is already spoken for by `/feed-health`
(`app/src/app/feed-health/page.tsx`). Two identical icons in one sidebar is a
worse outcome than either page having a second-choice icon; pick a distinct one
here.

## 4. Two API additions

Both in `routers/published_feeds.py`, both community.

**`GET /published-feeds/{slug}/attempts`** returns the recent attempts:
`attemptId`, `bindingRevision`, `queryResultId`, `decision`, `reason`,
`findings`, `enabledRules`, `isCurrent`, `createdAt`. Never `feedBytes`, which
is a `LargeBinary` with no business in a list response. Readable by any org
member, matching the other reads.

**`POST /published-feeds/{slug}/attempts`** runs one attempt and returns the row
it created, in the same shape the GET returns, so the client has one renderer
for both. Admin-gated. The handler reads the bound query's latest result
through `RedashClient` with the service key, then calls `run_attempt` with those
rows, that result id and a feed timestamp. This is the same work the enterprise
worker does per tick, done once, on request.

Both oblige `pnpm gen:api-types` from `app/`, or the committed `openapi.json`
diff fails `veodyn-api`.

## 5. Two status vocabularies, never blurred

**Mapping state** answers "could this binding ever produce a feed". It is
`ok`, `unvalidated` or `unknown`, and **it is only meaningful in a write
response**: `list_feeds` (line 186) and `get_feed` (line 241) both hard-code
`unknown`, because running the check costs a whole result body per binding and,
as `PublishedFeedOut` puts it, a green tick nothing verified is the one answer
worse than no answer.

The consequence for the UI is absolute: **no read path may display mapping
validity.** It appears once, inline, in the confirmation after a create or an
update, and never again.

**Serving state** answers "is anything being handed to consumers right now". It
comes from the attempt history: the latest attempt's decision, and which row
carries `isCurrent`. This is what the list column and the detail header show.

## 6. Workflows

### 6.1 Publish a query as a feed

Admin opens `/connect/feeds/new`, picks a query, and the form fetches that
query's latest result columns to populate the eight mapping rows, pre-selecting
exact name matches. The remaining fields are the slug, visibility, the static
GTFS reference, and the failure policy.

The pickers are closed sets on both sides, which makes two of
`check_column_map`'s three problem kinds unreachable by construction: no
unsupported field name can be typed, and no column the query does not return can
be chosen. What is left is the required-field case, caught before the request is
sent.

Refusals render at the field that caused them, never as a page banner:

| Response | Field |
|---|---|
| 422 `PUBLISHED_FEED_QUERY_UNREADABLE` | the query picker |
| 422 `PUBLISHED_FEED_BINDING_INVALID` | split the message on `"; "`, each problem at its own mapping row |
| 409 `PUBLISHED_FEED_SLUG_TAKEN` | the slug field |
| 422 from pydantic (slug pattern, cap or mode mismatch) | the named field |

A 201 carrying `unvalidated` is reported as saved, with the reason stated: the
query has no results yet, so nothing has checked the columns against reality.

### 6.2 Diagnose a feed that is not serving

The engine's three decisions mean different things and are presented
differently:

- **`published`**: bytes are served. It may still carry `WARNING` or `INFO`
  findings (`publish_engine.py:75`), which the page shows plainly and without
  alarm. A feed that published is not a feed with nothing to say about it.
- **`blocked`**: the validator returned `ERROR` findings. `reason` is a count,
  `"N conformance error(s)"` (`publish_engine.py:254-260`), so the findings
  themselves are the only actionable explanation and the UI must render them
  rather than the reason.
- **`failed`**: there was no finding to blame. One reason sentence: validator
  unavailable, serializer error, a result no newer than the published one, the
  binding retired mid-flight, or a superseded attempt.

Findings are flattened one per occurrence by `normalize_report`, so a single
broken rule arrives as many rows sharing a `ruleId`. The list groups by rule,
headlines the title, counts the occurrences, and puts the free-text locators
behind a disclosure. `failed` renders one sentence and no list, because there is
nothing to enumerate; rendering one as the other is the interesting bug here.

### 6.3 Change a live feed

`_take_the_feed_off_the_air` (line 132) clears the served pointer on **every**
edit and on delete, unconditionally, including for fields like `visibility` that
do not change the bytes. Its docstring is emphatic that this is an act rather
than an omission, and that going dark is the failure that announces itself.

So the save control on a serving feed reads "Save and republish" and confirms
first, stating that the feed goes off the air until an attempt succeeds and that
consumers get nothing meanwhile. On save the UI fires the attempt immediately,
so the dark window is one request rather than one worker cycle. A blocked or
failed attempt leaves the feed dark with its findings on screen.

A feed that is already dark skips the confirm: there is nothing to warn about.

**The trap.** `publish_engine.py:211-224` records an attempt as `failed` when
its `queryResultId` is not newer than the published one. Pressing publish when
the query has not re-run since the last publish therefore produces a failure
that reads as a bug. The page compares the query's latest result id against the
current artifact's before offering the control, and when they match it says the
query has produced nothing new instead of firing.

### 6.4 Retire a feed

Delete answers 204 whether or not the row existed, and clears the pointer, so
the feed goes dark permanently. The confirm says that consumers of the URL start
getting nothing, because nothing about a deleted slug distinguishes it from one
that never existed.

### 6.5 The non-admin view

The list and the detail page, with create, edit, delete and publish **absent**
rather than disabled, and a line saying publishing is administered. A disabled
control implies a permission you might acquire by trying; absence states the
arrangement.

## 7. Components

```
app/src/app/connect/feeds/{page,loading}.tsx
app/src/app/connect/feeds/new/{page,loading}.tsx
app/src/app/connect/feeds/[slug]/{page,loading}.tsx
app/src/app/connect/feeds/[slug]/edit/{page,loading}.tsx
app/src/app/api/published-feeds/route.ts
app/src/app/api/published-feeds/[slug]/route.ts
app/src/app/api/published-feeds/[slug]/attempts/route.ts

app/src/components/published-feeds/
  feed-form.tsx          orchestration and the grouped sections
  column-map-editor.tsx  the eight rows and their pickers
  query-picker.tsx       search over queries
  attempt-history.tsx    the list
  findings-list.tsx      grouped by ruleId
  serving-status.tsx     one status word, shared by row and header

app/src/services/published-feeds/client.ts
app/src/hooks/use-published-feeds.ts
app/src/stores/published-feed-slice.ts
app/src/lib/sidebar-nav.ts        one row
```

Data access follows `use-feeds.ts`: a service client, a hook per query and
mutation, mutations invalidating the list key.

`query-picker.tsx` has no primitive to build on. There is no combobox in
`components/ui/`; `shared/tag-suggest-input.tsx` is the closest existing
pattern. Either follow it or add a real combobox with
`pnpm dlx shadcn@latest add` from `app/`, confirming `@radix-ui` does not enter
a source import.

The mock slice is not optional. Mock mode issues no request at all, so without
fixtures every page here is blank in dev and in both demo packs.

## 8. Repo traps this feature walks into

**The form state will trip the file-size block, and the fix breaks
memoization.** Moving state into a hook makes its setters no longer
known-stable, so every `useCallback` closing over them fails
`react-hooks/preserve-manual-memoization`, an ESLint error. Return callbacks
from the hook rather than raw setters, as `use-query-buffer.ts` does.

**The field vocabulary cannot be derived from the API, so it needs a ratchet.**
`columnMap` is typed `{[key: string]: string}` on the wire, and nothing exposes
`REQUIRED_FIELDS` or `SUPPORTED_FIELDS`, so the picker's closed set has to be
hand-written in `app/`. That is the repo's normal api-to-app convention
(`app/src/types/feed.ts` mirrors its Python schema by hand), but here a drifting
copy fails in the direction `check_column_map`'s docstring warns about: a
binding the UI calls fine is one the serializer refuses at publish time. So the
vocabulary gets a checked-in ratchet in `api/tests/`, in the same shape and for
the same reason as `ce_module_allowlist.json`, asserting the serializer's two
frozensets against the values the frontend was written for. Changing the
serializer then fails a test that names the frontend file to update, rather
than shipping a picker that offers a field nothing writes.

**Declarations and their uses land in one edit.** `lint-on-edit` runs after
every edit at `--max-warnings 0`, so a new prop or import added separately from
its use fails on the intermediate state.

## 9. Testing

Beyond the happy path, each of these gets run with its implementation reverted
to confirm it can fail:

- Each refusal class lands on its own field, not in a banner.
- `blocked` renders findings and no reason; `failed` renders a reason and no
  findings list.
- Findings sharing a `ruleId` collapse into one group carrying an occurrence
  count.
- The publish control is withheld when the latest query result id equals the
  current artifact's, and the page says why rather than recording a `failed`
  attempt.
- Editing a serving feed shows the going-dark confirm; editing a dark feed does
  not.
- A non-admin sees no create, edit, delete or publish control on either page.
- `page.backend-failure.test.tsx` per route: an empty state is not an error
  state, and `shared/list-load-error.tsx` exists for this.

Gates: `pnpm gen:api-types` after the endpoints land, `pnpm lint` at
`--max-warnings 0`, and `tsc --noEmit` separately, since `pnpm test`
type-checks neither.

## 10. Open questions

1. **What path is a published feed actually served at?** Nothing in the tree
   names it. `routers.public` is enterprise and absent here, and the mechanism
   design refers to "the endpoint" without a shape (§6.5) and to a `feed_url`
   column without a format (§8.1). The detail page wants a copyable URL, so this
   has to be decided before the page can show one. Until it is, the page shows
   the slug and not a URL.
2. **How many attempts does the history return, and is it paged?** A feed
   publishing on a short cadence accumulates rows quickly. A fixed recent-N is
   enough for the first pass, but N has to be stated rather than inferred.
3. **Does the publish control belong in a community build at all**, or only
   where a worker exists? It is the only thing that makes the page do anything
   in community, which argues for keeping it; the counter-argument is that it
   invites an operator to hand-drive something the product does not otherwise
   promise. Mechanism design open question 5 covers the same ground.
