# validator-service

An HTTP wrapper around the `gtfs-rt-validator` PyPI package (0.2.0, pinned
exactly), so the sidecar can validate a GTFS-Realtime feed over the network
instead of holding a prepared archive (~1.9 GB, per feed) in every `veodyn-api`
replica. Built to the contract in
`.superpowers/sdd/validator-service/brief.md`; `api/veodyn_api/services/feed_validator.py`
is the client written against exactly this.

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
  1000 as installed at 0.2.0, not the smaller figure some earlier notes about
  this package assumed (verified directly against the installed source, see
  "Verified against the installed package" below). Either way, this service
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
package was actually installed (`gtfs-rt-validator==0.2.0`):

- `prepare_feed`, `Mode`, `Request`, `resolve`, `validate`,
  `report.modern.build_report`, `report.manifest.rule` all exist and match the
  brief's signatures.
- `report.occurrence.MAX_EXPORTS_PER_RULE` is **1000** in the installed 0.2.0,
  not 1. This does not change anything about the design (samples are still
  capped and `totalNotices` is still the true count, which is the property
  this service actually depends on. It is worth flagging since a smaller
  figure was assumed going in.
- `Inputs`, `Source`, `url_cycle`, `MessageResult` are real, documented,
  version-pinned surface (`gtfs_rt_validator.runner.__all__` /
  `gtfs_rt_validator.api.__all__`), narrower than the six-name list in the
  brief but not private (`_`-prefixed) either. They are what makes the
  previous-message plumbing above possible; the exact pin
  (`gtfs-rt-validator==0.2.0`) is what keeps a future package bump from moving
  this surface out from under the service without anything here noticing at
  install time.

## Configuration

Environment variables, prefixed `VALIDATOR_`. See `.env.example` for the full
list with reasoning; in summary: `VALIDATOR_PORT` (bind port),
`VALIDATOR_CACHE_SIZE`, `VALIDATOR_CACHE_TTL_SECONDS`,
`VALIDATOR_STATIC_FETCH_TIMEOUT_SECONDS`. No secrets: this service
authenticates nobody.

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
`tests/test_cache.py`, `tests/test_fetch.py`: no real `prepare_feed`, no
network, no 48 second wait) and exercise the real package for the wiring that
actually matters (`tests/test_validation_wiring.py`): a real `PreparedFeed`
built from an empty, hand-constructed static context
(`gtfs_rt_validator.static.context.StaticContext.build` is a pure function
over already-parsed rows, so this costs microseconds) and real, decodable
GTFS-Realtime bytes built with the package's own fixture-building
`proto.encode.encode` helper. See `tests/fixtures.py`.

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
