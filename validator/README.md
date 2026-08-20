# validator-service

An HTTP wrapper around two PyPI packages, both pinned exactly:
`gtfs-rt-validator` (0.3.0) for realtime feeds and `gtfs-validator` (0.1.2) for
static GTFS archives. It exists so the sidecar can validate either kind of
feed over the network instead of holding a prepared archive (~584 MB, per
feed) in every `veodyn-api` replica. The HTTP contract below is the
specification; `api/veodyn_api/services/published_feed_validator.py` is the
client written against exactly the `/validate` half of it.

## The HTTP contract

**`POST /validate`**, multipart:

- `feed`: the GTFS-Realtime protobuf bytes, required.
- `previous`: the previous message's bytes, optional. Drives previous-
  iteration rules (header timestamp progression, schedule_relationship
  transitions, and so on); an empty or garbage upload is treated as if this
  field were absent rather than as a request error, since it is a best-effort
  optimization input, not a second payload this service validates.
- form field `gtfs`: a URL string for the static GTFS zip.

**200** returns the package's own `report.modern.build_report` shape, with one
addition per notice:

```json
{
  "summary": { "...": "...", "mode": "modern", "rulesRun": ["E001", "..."] },
  "notices": [
    {
      "code": "E003",
      "severity": "ERROR",
      "title": "trip_id does not exist",
      "totalNotices": 40,
      "sampleNotices": [{ "prefix": "vehicle_id b1" }]
    }
  ]
}
```

- `title` is not in the package's native report. It is looked up from
  `report.manifest.rule(code).title`, which only knows the packed manifest's
  61 upstream (`E`/`W`) ids. A `spec`/`practice` code (`S`/`P` prefix) has no
  manifest entry and gets `title: ""` rather than a 500.
- `rulesRun` is passed through exactly as the package's own `RunSummary`
  produces it, absent-vs-`[]` included. Nothing in this service defaults or
  rewrites it; see "Why the previous message needs its own plumbing" below for
  the one place this matters.
- `totalNotices` is the true count; `sampleNotices` is capped by the package's
  own `NoticeContainer` (`report.occurrence.MAX_EXPORTS_PER_RULE`, currently
  1000 as installed at 0.3.0, not the smaller figure some earlier notes about
  this package assumed), verified directly against the installed source; see
  "Verified against the installed package" below. Either way, this service
  never re-samples or expands `sampleNotices`: the two numbers are read
  straight off the package and forwarded (see "Verified against the installed
  package" below for the exact figure).

**Non-200**: JSON body is `{"error": "<message>"}`.

- **400**: the `gtfs` form field is blank, `feed` is empty, or `feed` does not
  decode as a GTFS-Realtime `FeedMessage`.
- **502**: the static GTFS archive at `gtfs` could not be fetched, or was
  fetched but did not load as GTFS. The brief's example only names the fetch
  case; this service extends 502 to cover a failed load too, since both are
  the agency's static reference being unusable rather than anything wrong with
  the request itself. See `validator_service/fetch.py`'s `StaticFetchError`.
- **503**: a prepare for that `gtfs` URL is already in flight for another
  request. See "Concurrency" below for why this is a 503 rather than a queue.

**`POST /validate-static`**, multipart, validates a GTFS static archive with
`gtfs_validator.pipeline.run_validation` rather than fetching one purely as
`/validate`'s reference. Exactly one of:

- `archive`: the GTFS zip, uploaded directly.
- form field `gtfs`: a URL to download the zip from, fetched through the same
  `validator_service/fetch.py` machinery `/validate` uses for its static
  reference (the same timeout setting, the same `StaticFetchError` handling).

Both present is **400**. Both absent is also **400**, and an empty upload
counts as absent for this check: `UploadFile.size` is known before the
handler runs (starlette's multipart parser sets it), so an empty `archive`
alongside a real `gtfs` URL uses the URL rather than tripping the both-inputs
error. An empty `archive` with no `gtfs` at all is still its own 400
("archive must not be empty").

**200** returns:

```json
{
  "report": { "summary": { "...": "..." }, "notices": [{ "...": "..." }] },
  "systemErrors": { "notices": [{ "...": "..." }] }
}
```

`report` is exactly what the package's own CLI writes to `report.json`
(summary plus notices, including `validationTimeSeconds` and
`memoryUsageRecords` on a successful run: this service builds and populates a
`summary.Register` the same way `cli.py` does); `systemErrors` is exactly what
it writes to `system_errors.json`. Both come straight from the package's own
`report.build_report`, `report.build_system_errors` and `summary.build_summary`
so this service is not reimplementing their shape.

A notice's context can carry a raw `Decimal` (a `DECIMAL`/`CURRENCY_AMOUNT`
field out of bounds reports the value itself, scale and all, per the
package's own `typing_checks.check_number`). The response is serialized with
the package's own `report.dumps_json`, not `fastapi.responses.JSONResponse`'s
stdlib `json.dumps`, which cannot encode a `Decimal` at all and would 500
instead of returning the report.

- **An archive that will not open at all is still a 200.** The package's own
  `pipeline.run_validation` does not raise for this: it records the failure in
  `system_errors` and returns `(None, False)`, the same as a feed that opened
  but failed a table midway. Since the package treats "never opened" and
  "opened but a table failed" as the same kind of outcome (processed, with a
  failure recorded, not a request error), this service does too, and answers
  200 either way with the failure visible in `systemErrors`. Only the request
  shape itself (both/neither input, an empty upload with no URL, a resource
  bound exceeded) is a 400 or 502; see "Resource bounds" below.
- **502** if the `gtfs` URL could not be fetched, including a malformed URL
  (`httpx.InvalidURL`, caught alongside `httpx.HTTPError`) or a download that
  exceeded the compressed-size limit. Same interpretation as `/validate`'s
  502: reaching or trusting the archive is this service's problem, not the
  caller's request shape.

### Resource bounds

Both input paths are capped, since either hands this service bytes from
outside its control:

- **The whole request body is capped before either route's own parsing runs**
  (`VALIDATOR_STATIC_ARCHIVE_MAX_COMPRESSED_BYTES` plus a fixed 64 KB of
  multipart slack). FastAPI's multipart parser spools an upload to a
  `SpooledTemporaryFile` while resolving `archive`/`feed` into an
  `UploadFile`, entirely before a route handler (and so a handler-level
  check) ever runs, so a per-route check alone cannot bound how much lands on
  disk. `validator_service/body_size_limit.py`'s `MaxBodySizeMiddleware`,
  installed app-wide in `main.py`, counts bytes off the raw ASGI `receive`
  callable as they arrive and answers **413** once the cap is exceeded,
  before the multipart parser reads them at all. It covers `/validate` too:
  that route reads its own realtime `feed` upload fully with no bound of its
  own, so one middleware fixes both.
- **Compressed size** (same setting) is enforced a second time, per input
  path, as defense in depth and as the source of the specific error each path
  reports: an oversized **upload** is a **400** (the caller's own bytes, a
  request problem), enforced by `archive_limits.write_capped`, which streams
  from the `UploadFile`'s underlying file with a running byte counter,
  off the event loop (inside the threadpooled call); an oversized
  **download** is a **502** (grouped with the other ways fetching the `gtfs`
  URL can fail, per the choice above), enforced by `fetch.download`'s own
  counter while streaming.
- **Uncompressed size** (`VALIDATOR_STATIC_ARCHIVE_MAX_UNCOMPRESSED_BYTES`,
  default 4 GB) is checked against the zip's own central directory, once the
  archive is on disk regardless of origin, before validation runs. This is
  the zip-bomb case a compressed-byte counter cannot catch: a small
  compressed file can still declare an enormous uncompressed total. Exceeding
  it is a **400**. A file that is not a valid zip at all, or one whose
  central directory `zipfile` itself cannot parse (an invalid-UTF-8 filename
  under the archive's own UTF-8 flag raises `UnicodeDecodeError`, not
  `BadZipFile`), is left to `run_validation`'s own system-error handling
  above, not rejected here: this precheck must never produce a failure mode
  the package itself would not.

See `validator_service/archive_limits.py` and `validator_service/body_size_limit.py`.

**`GET /health`** returns 200 while the process is up.

## The prepared-feed cache

`gtfs_rt_validator.api.validate` reloads the static archive on every call
unless handed a `PreparedFeed`; that reload is ~48 seconds and peaks at
~584 MB resident for an MBTA-sized archive, measured on the pinned
gtfs-rt-validator 0.3.0 against `corpus/agencies/mdb-437` (18 MB, 92,360
trips). This service caches one `PreparedFeed` per `gtfs` URL so repeat
validations cost the sub-second rule pass instead.

The memory figure tracks the pin, not the archive: the same archive cost about
3.5 GB on 0.2.0, and the 2026-08-13 spike behind
`docs/superpowers/specs/2026-08-13-validated-feed-publishing-design.md`
section 6.6 reported ~1.9 GB, which that spike measured as a live object graph
rather than as resident memory. Re-measure RSS when the pin moves; the pod's
limit is enforced against RSS, and an object-graph number can fall while
resident memory does not move at all.

- **Cache size defaults to 1** (`VALIDATOR_CACHE_SIZE`). A node serves one
  agency and carries one `static_gtfs_ref`, so 1 is the normal case, and the
  default must not surprise anyone into 2x the memory they expected.
- **TTL defaults to 3600 seconds** (`VALIDATOR_CACHE_TTL_SECONDS`). The
  package never re-reads an archive on its own once prepared, and an agency
  publishes to a stable URL whose *contents* change, so the TTL is the only
  thing that ever notices staleness. An hour is a ~75x margin over the ~48
  second rebuild and well inside typical static-schedule change cadence
  (service changes are a daily event, not a minute-to-minute one).
- **No headroom for two copies.** A stale entry is dropped the moment it is
  found stale, before its replacement starts building, rather than kept alive
  until the rebuild finishes. The alternative would let the default size-1
  cache spike to roughly double (two archives resident at once) during every
  rebuild, which is exactly the surprise the default above is supposed to rule
  out.
  Dropping first costs a gap instead: the request that finds the entry gone
  pays the full ~48 second rebuild.
- **Concurrent requests for one URL do not queue.** A second request for a
  `gtfs` URL that is already being prepared gets 503 immediately rather than
  waiting on the first prepare. Holding an HTTP request open for ~48 seconds
  risks the wrong timeout firing somewhere upstream of this service (a proxy,
  a load balancer, the caller's own client), and 503 is a state a caller can
  already retry cheaply. This is also literally one of the non-200 outcomes
  the brief names.
- Requests for a **different** URL are never blocked by another URL's
  in-flight prepare; the single-flight guard is per key.

See `validator_service/cache.py` for the implementation; its module docstring
repeats this reasoning next to the code it governs.

## Why the previous message needs its own plumbing

`gtfs_rt_validator.api.validate` walks every cycle it is handed and merges
every message's own findings into one report: correct for an archive replay,
wrong for a previous-iteration comparison. If `previous` were simply added as
an earlier cycle, its own findings (whatever was wrong with the *last*
published message, however unrelated to this one) would silently fold into
`totalNotices` for the message actually being validated.

So this service builds two cycles, previous then current (see
`gtfs_rt_validator.runner.url_cycle`), lets `validate`'s `sink` hand back every
message's own `NoticeContainer`, and keeps only the current message's. The
previous message still drives `RuleContext.previous` for iteration-sensitive
rules exactly as the package intends; only its own findings are excluded from
the report. `tests/test_validation_wiring.py::test_previous_message_findings_are_excluded_from_the_report`
is the regression test for this, run against the real package (not a mock).

## Verified against the installed package

The brief flagged several things to confirm rather than assume once the
package was actually installed, re-confirmed against the current pin
(`gtfs-rt-validator==0.3.0`):

- `prepare_feed`, `Mode`, `Request`, `resolve`, `validate`,
  `report.modern.build_report`, `report.manifest.rule` all exist and match the
  brief's signatures.
- `report.occurrence.MAX_EXPORTS_PER_RULE` is **1000** in the installed 0.3.0,
  not 1. This does not change anything about the design: samples are still
  capped and `totalNotices` is still the true count, which is the property
  this service actually depends on. It is worth flagging since a smaller
  figure was assumed going in.
- `report.manifest.all_ids()` returns **61** ids (52 `E`, 9 `W`), the figure
  the title lookup above is written against.
- `Inputs`, `Source`, `url_cycle`, `MessageResult` are real, documented,
  version-pinned surface (`gtfs_rt_validator.runner.__all__` /
  `gtfs_rt_validator.api.__all__`), narrower than the six-name list in the
  brief but not private (`_`-prefixed) either. They are what makes the
  previous-message plumbing above possible; the exact pin
  (`gtfs-rt-validator==0.3.0`) is what keeps a future package bump from moving
  this surface out from under the service without anything here noticing at
  install time.

## Static validation

`gtfs_validator.pipeline.run_validation` has no equivalent to `PreparedFeed`:
each `/validate-static` request downloads or reads its archive, opens it,
walks every table and runs the rule set fresh. There is no cache for it,
unlike the realtime endpoint's static reference. `validator_service/static_validation.py`
wraps the call, building the same `report`/`summary`/`systemErrors` shapes
`cli.py` writes to disk, including a `summary.Register` populated the same way
(`register.register("validate")` after the pipeline returns, matching `cli.py`
exactly), without any of the CLI's argument parsing or file output.

## Configuration

Environment variables, prefixed `VALIDATOR_`. See `.env.example` for the full
list with reasoning; in summary: `VALIDATOR_PORT` (bind port),
`VALIDATOR_CACHE_SIZE`, `VALIDATOR_CACHE_TTL_SECONDS`,
`VALIDATOR_STATIC_FETCH_TIMEOUT_SECONDS`,
`VALIDATOR_STATIC_ARCHIVE_MAX_COMPRESSED_BYTES`,
`VALIDATOR_STATIC_ARCHIVE_MAX_UNCOMPRESSED_BYTES` (see "Resource bounds"
above). No secrets: this service authenticates nobody.

## Development

```sh
cd validator
uv sync
uv run ruff format --check .
uv run ruff check .
uv run mypy .
uv run pytest
```

Tests fake the package boundary for the HTTP layer (`tests/test_routes.py`,
`tests/test_static_routes.py`, `tests/test_static_routes_limits.py`,
`tests/test_cache.py`, `tests/test_fetch.py`, `tests/test_archive_limits.py`,
`tests/test_body_size_limit.py`: no real `prepare_feed`, no real pipeline run,
no network, no 48 second wait)
and exercise the real package for the wiring that actually matters
(`tests/test_validation_wiring.py` for realtime, `tests/test_static_validation.py`
for static): a real `PreparedFeed` built from an empty, hand-constructed static
context (`gtfs_rt_validator.static.context.StaticContext.build` is a pure
function over already-parsed rows, so this costs microseconds), real,
decodable GTFS-Realtime bytes built with the package's own fixture-building
`proto.encode.encode` helper, and a tiny real GTFS zip built in memory for the
static pipeline. See `tests/fixtures.py`.

## How this is deployed

The chart is `helm/charts/veodyn-validator` and the dev environment's values
are `helm/envs/veodyn-validator-dev/`. Three things about it are load-bearing
and each has a render check in `scripts/check-helm-render.sh`:

- **No Ingress, and a ClusterIP Service.** This service authenticates nobody
  and one request makes it download a URL of the caller's choosing, so only
  `api` reaches it, in-cluster. Every other service here has a public ingress;
  this one is the exception on purpose.
- **One replica, `Recreate`.** Each replica prepares and holds its own archive,
  so a second replica doubles the memory rather than sharing the work, and a
  rolling update would need headroom for two prepared archives on one node.
- **Memory sized on `VALIDATOR_CACHE_SIZE *` the per-entry peak** (default
  size 1, ~584 MB on the pinned 0.3.0, so 1Gi request and 2Gi limit) rather
  than a generic service's footprint. This is the one thing that makes the
  service unusual to size, and the figure moves with the pin.

`api`'s `VEODYN_FEED_VALIDATOR_URL` must name that Service; the render script
checks the dev values on both sides agree, because a wrong string there is a
green deploy where every publish attempt records an unreachable validator.
- No liveness concern beyond `GET /health`; no external dependencies to probe
  (this service fetches the static GTFS archive itself, per request, rather
  than depending on another in-cluster service for it).
