# Published Feed UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give published feeds a product surface: a list, a detail page with attempt history, and an admin form that declares a binding and publishes it on demand.

**Architecture:** Two endpoints are added to the existing community router so the app can read the attempt record and drive one attempt without a worker. The frontend follows the repo's established sidecar path: a same-origin proxy route reading config from the env boundary, a hand-rolled service client raising `AppError`, TanStack Query hooks with a mock-store fallback, and pages built from the shared list/detail primitives.

**Tech Stack:** FastAPI + SQLAlchemy + pydantic (uv, Python 3.11) on the API side. Next.js 16 App Router, React 19, TypeScript, TanStack Query, Zustand, Base UI + shadcn, Tailwind v4, vitest (pnpm) on the app side.

**Spec:** `docs/superpowers/specs/2026-08-14-published-feed-ui-design.md`

## Global Constraints

- **No long dashes anywhere**, of either width. `app/src/test/redash-era-chrome.ts:26-93` carries a pattern named `em or en dash` covering both codepoints, and it fails any file listed in a `*.restyle.test.ts`, comments included. Use a period, comma, colon, or parentheses.
- **`api/openapi.json` is committed and CI diffs it.** After any route or schema change run, from `app/`, `pnpm gen:api-types`. It regenerates both `api/openapi.json` and `app/src/types/generated/veodyn-api.d.ts`. `ci/veodyn-api-test.yaml:48-49` fails on a diff.
- **The `veodyn-api` gate is `ruff check`, `ruff format --check`, `mypy veodyn_api`, `pytest`, and the openapi diff.** Run `uv run ruff format .` from `api/` before committing. Formatting alone fails it.
- **The `veodyn-de` gate is `pnpm lint` at `--max-warnings 0`, `tsc --noEmit`, and `pnpm test`.** `pnpm test` does NOT type-check, so a green suite is not a green `tsc`. Every rule in `app/eslint.config.mjs:27-37` is a `warn` and therefore fatal.
- **No raw `<label>`, `<button>` or `<table>` in `src/app/**` or `src/components/**`.** `no-restricted-syntax` errors on them (`app/eslint.config.mjs:48-85`). Use `ui/label` with `htmlFor`, `ui/button`, `ui/table`. Raw `<input>`, `<select>` and `<textarea>` are not banned by lint, but `redash-era-chrome.ts` bans `<select`, so use `ui/select`.
- **300 lines is a hard block on writes** (`.harness/file-size.conf`, `BLOCK_THRESHOLD=300`). Split before you hit it.
- **A declaration and its uses land in one edit.** `lint-on-edit` runs after every edit at `--max-warnings 0`, so an import added without its use, or a prop added without its consumer, fails on the intermediate state. Use one `Write`, or one `Edit` with `replace_all`.
- **Server-side `process.env` is read only in `app/src/lib/env.ts`.** Consume `env.X`. `NEXT_PUBLIC_*` is exempt and read directly.
- **Icon-only controls use `IconButton` with a `tooltip`** (`app/src/components/shared/icon-button.tsx`), never the native `title` attribute.
- **Every `fetch` in a service client takes `opts: { signal?: AbortSignal } = {}`** and passes it through, matching `app/src/services/catalog/client.ts`.
- **Commit after each task.** Do not batch.

## File Structure

**API (all community, all in `api/veodyn_api/`):**

| File | Responsibility |
|---|---|
| `schemas/published_feed.py` (modify) | adds `FindingOut` and `PublishAttemptOut`, the attempt wire model |
| `services/publish_source.py` (create) | reads a query's latest result as rows + id + retrieval time, raising rather than swallowing |
| `services/publish_validator.py` (create) | builds the production `Validate` callable from settings; fails closed when no validator is configured |
| `routers/published_feeds.py` (modify) | adds `GET` and `POST` on `/{slug}/attempts` |
| `tests/gtfs_field_vocabulary.json` (create) | the serializer's field sets as a checked-in ratchet, so a change is a decision that names the frontend copy |

**App (`app/src/`):**

| File | Responsibility |
|---|---|
| `app/api/published-feeds/route.ts` (create) | proxy for the collection: GET list, POST create |
| `app/api/published-feeds/[slug]/route.ts` (create) | proxy for one feed: GET, PUT, DELETE |
| `app/api/published-feeds/[slug]/attempts/route.ts` (create) | proxy for the attempt record: GET, POST |
| `types/published-feed.ts` (create) | the app-facing view types, pinned to the wire by a contract test |
| `lib/gtfs-fields.ts` (create) | the closed field vocabulary the mapping editor offers |
| `services/published-feeds/client.ts` (create) | the six calls, each wrapping failure in `AppError` |
| `hooks/use-published-feeds.ts` (create) | queries and mutations, with the mock-store branch |
| `stores/published-feed-slice.ts` (create) | mock-mode fixtures, without which every page is blank in dev |
| `components/published-feeds/serving-status.tsx` (create) | one status word, shared by the list row and the detail header |
| `components/published-feeds/findings-list.tsx` (create) | findings grouped by rule, occurrences disclosed |
| `components/published-feeds/attempt-history.tsx` (create) | the attempt list, and the blocked-vs-failed split |
| `components/published-feeds/column-map-editor.tsx` (create) | the eight mapping rows and their pickers |
| `components/published-feeds/query-picker.tsx` (create) | search over queries, modelled on `add-widget-search.tsx` |
| `components/published-feeds/feed-form.tsx` (create) | the grouped form, shared by create and edit |
| `app/connect/feeds/page.tsx` (create) | the list |
| `app/connect/feeds/new/page.tsx` (create) | create |
| `app/connect/feeds/[slug]/page.tsx` (create) | detail |
| `app/connect/feeds/[slug]/edit/page.tsx` (create) | edit, including the going-dark confirm |
| `lib/sidebar-nav.ts` (modify) | one CONNECT row |
| `lib/errorIds.ts` (modify) | one new cause |

---

### Task 1: The attempt read model and `GET /published-feeds/{slug}/attempts`

**Files:**
- Modify: `api/veodyn_api/schemas/published_feed.py`
- Modify: `api/veodyn_api/routers/published_feeds.py`
- Create: `api/tests/test_published_feed_attempts_route.py`
- Modify: `api/openapi.json`, `app/src/types/generated/veodyn-api.d.ts` (both regenerated)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `FindingOut`, `PublishAttemptOut` (in `schemas/published_feed.py`); `ATTEMPT_PAGE_SIZE: int`, `_attempt_out(attempt: PublishAttempt) -> PublishAttemptOut`, `_iso(moment: datetime) -> str` (in `routers/published_feeds.py`). Task 2 calls `_attempt_out`. Task 5 consumes the wire shape.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_published_feed_attempts_route.py`:

```python
"""Reading one feed's publish record.

`@respx.mock` is a per-test decorator here for the same reason it is next door
in test_published_feeds_route.py: an autouse fixture would intercept every
call in the module, including the ones a test means to leave alone.
"""

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from published_feed_route_stubs import BOUND_COLUMNS, ADMIN, MEMBER, as_user, auth, binding, create, set_columns
from publish_stubs import CLEAN, ERRORED, attempt_row, run
from veodyn_api.models.publish_attempt import PublishAttempt


def _a_feed(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201


@respx.mock
def test_attempts_come_back_newest_first(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, db, monkeypatch)
    feed = binding(db)
    run(db, feed, CLEAN, result_id=100)
    run(db, feed, ERRORED, result_id=101)

    response = api.get("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 200
    body = response.json()
    assert [row["decision"] for row in body] == ["blocked", "published"]
    assert body[0]["queryResultId"] == 101


@respx.mock
def test_the_findings_ship_with_the_attempt(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, db, monkeypatch)
    run(db, binding(db), ERRORED, result_id=101)

    body = api.get("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert body[0]["findings"], "a blocked attempt with no findings explains nothing"
    finding = body[0]["findings"][0]
    assert set(finding) == {"ruleId", "severity", "title", "locator"}
    assert body[0]["enabledRules"]


@respx.mock
def test_the_served_bytes_never_ship(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """The artifact is up to a few megabytes and nothing on the page renders it."""
    _a_feed(api, db, monkeypatch)
    run(db, binding(db), CLEAN, result_id=100)

    body = api.get("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert body[0]["isCurrent"] is True
    assert "feedBytes" not in body[0]


@respx.mock
def test_a_member_may_read_the_record(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Reads are open to the org, the same line the list and get endpoints hold."""
    _a_feed(api, db, monkeypatch)
    run(db, binding(db), CLEAN, result_id=100)
    as_user(MEMBER)

    response = api.get("/published-feeds/vehicles/attempts", headers=auth("mo"))

    assert response.status_code == 200
    assert len(response.json()) == 1


@respx.mock
def test_an_unknown_slug_is_a_404_not_an_empty_list(api: TestClient) -> None:
    """A feed that was deleted and a feed with no attempts are different facts."""
    as_user(ADMIN)

    response = api.get("/published-feeds/nothing-here/attempts", headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NOT_FOUND"


@respx.mock
def test_only_the_most_recent_page_comes_back(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, db, monkeypatch)
    feed = binding(db)
    for result_id in range(200, 225):
        db.add(attempt_row(feed, decision="failed", feed_bytes=None, is_current=False, query_result_id=result_id))
    db.commit()

    body = api.get("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert len(body) == 20
    assert body[0]["queryResultId"] == 224
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && uv run pytest tests/test_published_feed_attempts_route.py -v`
Expected: FAIL. Every test errors on the 404 from an unrouted path, and the import of `BOUND_COLUMNS` fails if that name is not exported by `publish_stubs`. If `BOUND_COLUMNS` does not exist, read `api/tests/published_feed_route_stubs.py` for the constant it actually uses for `set_columns` and import that instead.

- [ ] **Step 3: Add the wire models**

Append to `api/veodyn_api/schemas/published_feed.py`:

```python
class FindingOut(CamelModel):
    """One validator finding, flattened to one occurrence.

    `publish_engine._as_json` already stores these camelCased, because that
    column is served verbatim. CamelModel's `populate_by_name` accepts either
    spelling, so this validates straight off the stored JSONB.
    """

    rule_id: str
    severity: str
    title: str
    locator: str


class PublishAttemptOut(CamelModel):
    """One attempt, without the bytes it produced.

    `feed_bytes` is absent on purpose rather than by omission. It is the served
    artifact, and a list endpoint that carried it would move megabytes per row
    to render a status word.
    """

    attempt_id: int
    binding_revision: int
    query_result_id: int
    # published | blocked | failed
    decision: str
    # Empty on a published attempt. A count on a blocked one, so the findings
    # are the actionable half. A sentence on a failed one, where there is no
    # finding to blame.
    reason: str
    findings: list[FindingOut]
    # What the verdict covered. A rule that never ran is not a rule that passed.
    enabled_rules: list[str]
    is_current: bool
    # ISO 8601 with a Z, matching every other timestamp this service serves.
    created_at: str
```

- [ ] **Step 4: Add the endpoint**

In `api/veodyn_api/routers/published_feeds.py`, extend the imports and add the handler in one edit. The import block gains `from datetime import UTC, datetime`, `defer` from `sqlalchemy.orm`, `PublishAttempt` from `veodyn_api.models.publish_attempt`, and `FindingOut, PublishAttemptOut` from the schemas module.

```python
# The list is a glance at recent history, not an archive. A feed publishing on
# a short cadence writes a row per tick, and what the page needs is the current
# artifact plus enough context to see a pattern. Paging arrives with a reader
# who needs it, and this constant is where that decision is recorded.
ATTEMPT_PAGE_SIZE = 20


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _attempt_out(attempt: PublishAttempt) -> PublishAttemptOut:
    return PublishAttemptOut(
        attempt_id=attempt.attempt_id,
        binding_revision=attempt.binding_revision,
        query_result_id=attempt.query_result_id,
        decision=attempt.decision,
        reason=attempt.reason,
        findings=[FindingOut.model_validate(finding) for finding in attempt.findings],
        enabled_rules=list(attempt.enabled_rules),
        is_current=attempt.is_current,
        created_at=_iso(attempt.created_at),
    )


@router.get("/{slug}/attempts", response_model=list[PublishAttemptOut])
def list_attempts(identity: IdentityDep, db: DbDep, slug: str) -> list[PublishAttemptOut]:
    """The recent record for one feed, newest first.

    `_load` first, so an unknown slug is a 404 rather than an empty list. A feed
    that was deleted and a feed that has never published are different facts and
    the page says different things about them.

    `defer` on the bytes column is load-bearing, not a micro-optimisation: these
    rows carry the served artifact, and selecting twenty of them to render
    twenty status words would move the whole feed history over the wire.
    """
    feed = _load(db, identity.org_slug, slug)
    rows = db.execute(
        select(PublishAttempt)
        .options(defer(PublishAttempt.feed_bytes))
        .where(PublishAttempt.org_slug == feed.org_slug, PublishAttempt.slug == feed.slug)
        .order_by(PublishAttempt.attempt_id.desc())
        .limit(ATTEMPT_PAGE_SIZE)
    ).scalars()
    return [_attempt_out(row) for row in rows]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_published_feed_attempts_route.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 6: Regenerate the contract and run the gate**

Run, from `app/`: `pnpm gen:api-types`
Run, from `api/`: `uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api && uv run pytest`
Expected: all pass, and `git status` shows `api/openapi.json` and `app/src/types/generated/veodyn-api.d.ts` modified.

- [ ] **Step 7: Commit**

```bash
git add api/veodyn_api/schemas/published_feed.py api/veodyn_api/routers/published_feeds.py api/tests/test_published_feed_attempts_route.py api/openapi.json app/src/types/generated/veodyn-api.d.ts
git commit -m "feat(api): let a caller read what a feed's publish attempts decided"
```

---

### Task 2: `POST /published-feeds/{slug}/attempts`, one attempt on demand

**Files:**
- Create: `api/veodyn_api/routers/published_feed_attempts.py`
- Create: `api/veodyn_api/services/publish_source.py`
- Create: `api/veodyn_api/services/publish_validator.py`
- Modify: `api/veodyn_api/routers/published_feeds.py`, `api/veodyn_api/routers/__init__.py`
- Modify: `api/veodyn_api/errors.py`
- Modify: `api/tests/ce_module_allowlist.json`
- Create: `api/tests/test_publish_now_route.py`
- Modify: `api/openapi.json`, `app/src/types/generated/veodyn-api.d.ts`

**Step 0, before anything else: move Task 1's attempt code into its own router.** Task 1 left `published_feeds.py` at 274 lines against a 300-line hard block, so this task's handler does not fit. Create `routers/published_feed_attempts.py` with its own `APIRouter(prefix="/published-feeds", tags=["published-feeds"])` and move `list_attempts`, `_attempt_out`, `_iso` and `ATTEMPT_PAGE_SIZE` into it unchanged. Promote `_load` to `load_feed` and `_require_admin` to `require_admin` in `published_feeds.py`, updating their call sites there, and import both into the new module. Register the new router in `routers/__init__.py` beside the existing one, and add it to `ce_module_allowlist.json`.

This must produce NO change to `api/openapi.json`: FastAPI derives `operationId` from the function name, path and method, so a moved function keeps its contract. Regenerate and confirm the diff is empty before adding anything new. If it is not empty, stop and report, because something other than the move changed.

Then add `publish_now` to the new module rather than to `published_feeds.py`.

**Interfaces:**
- Consumes: `_attempt_out`, `_load`, `_require_admin` from Task 1 and the existing router.
- Produces: `LatestResult` (frozen dataclass: `result_id: int`, `rows: list[dict[str, Any]]`, `retrieved_at: int`), `latest_result(redash: RedashClient, query_id: int, api_key: str) -> LatestResult`, `build_validate(settings: Settings) -> Validate`, and `ErrorId.PUBLISHED_FEED_NO_RESULT`.

Background the implementer needs: `run_attempt(db, feed, rows, query_result_id=..., feed_timestamp=..., validate=...)` lives in `services/publish_engine.py`. It never raises for an expected failure, it writes the attempt row itself, and `_record` calls `db.commit()`, so the handler must not commit again. `rows` is a list of dicts keyed by the query's own column names. Nothing in the tree builds a production `Validate` today, and `settings.feed_validator_url` is read by nothing; an empty value means no validator is configured and an attempt must fail closed rather than publish unvalidated bytes.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_publish_now_route.py`:

```python
"""Driving one publish attempt from a request.

A community deployment runs no worker (api/README.md:30), so this endpoint is
the only thing that makes a saved binding do anything. The engine is left to
decide: these tests assert what the endpoint hands it and what it hands back,
not what publishing means.
"""

from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from published_feed_route_stubs import (
    ADMIN,
    BOUND_COLUMNS,
    MEMBER,
    REDASH,
    as_user,
    auth,
    binding,
    create,
    set_columns,
)
from veodyn_api.services.feed_validator import Finding, ValidationOutcome


def _result(rows: list[dict[str, Any]], result_id: int = 500) -> None:
    """Redash answering with a cached result for query 42."""
    respx.get(f"{REDASH}/api/queries/42").mock(
        return_value=httpx.Response(200, json={"id": 42, "latest_query_data_id": result_id})
    )
    respx.get(f"{REDASH}/api/query_results/{result_id}").mock(
        return_value=httpx.Response(
            200,
            json={
                "query_result": {
                    "id": result_id,
                    "retrieved_at": "2026-08-14T10:00:00.000Z",
                    "data": {"columns": [{"name": name} for name in BOUND_COLUMNS], "rows": rows},
                }
            },
        )
    )


def _a_feed(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201


def _validator(monkeypatch: pytest.MonkeyPatch, outcome: ValidationOutcome) -> None:
    monkeypatch.setattr(
        "veodyn_api.routers.published_feeds.build_validate",
        lambda settings: (lambda feed_bytes, static_ref, previous: outcome),
    )


CLEAN = ValidationOutcome(findings=(), enabled_rules=("E003",))
ERRORED = ValidationOutcome(
    findings=(Finding(rule_id="E003", severity="ERROR", title="bad id", locator="entity 0"),),
    enabled_rules=("E003",),
)


@respx.mock
def test_an_attempt_publishes_and_comes_back_as_the_current_artifact(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}])
    _validator(monkeypatch, CLEAN)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 201
    body = response.json()
    assert body["decision"] == "published"
    assert body["isCurrent"] is True
    assert body["queryResultId"] == 500


@respx.mock
def test_a_blocked_attempt_is_recorded_and_returned_with_its_findings(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}])
    _validator(monkeypatch, ERRORED)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 201
    body = response.json()
    assert body["decision"] == "blocked"
    assert body["isCurrent"] is False
    assert body["findings"][0]["ruleId"] == "E003"


@respx.mock
def test_a_query_that_has_never_run_is_refused_before_an_attempt_is_recorded(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No result means nothing to publish, which is not a failed attempt."""
    _a_feed(api, monkeypatch)
    respx.get(f"{REDASH}/api/queries/42").mock(return_value=httpx.Response(200, json={"id": 42}))

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NO_RESULT"
    assert api.get("/published-feeds/vehicles/attempts", headers=auth()).json() == []


@respx.mock
def test_a_missing_validator_fails_closed_rather_than_publishing(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No VEODYN_FEED_VALIDATOR_URL is the community default, and it must not publish."""
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}])

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 201
    body = response.json()
    assert body["decision"] == "failed"
    assert "validator" in body["reason"].lower()
    assert body["isCurrent"] is False


@respx.mock
def test_a_non_admin_may_not_publish(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, monkeypatch)
    as_user(MEMBER)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth("mo"))

    assert response.status_code == 403
    assert response.json()["error"]["id"] == "VEODYN_FORBIDDEN"


@respx.mock
def test_publishing_an_unknown_feed_is_a_404(api: TestClient) -> None:
    as_user(ADMIN)

    response = api.post("/published-feeds/nothing-here/attempts", headers=auth())

    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && uv run pytest tests/test_publish_now_route.py -v`
Expected: FAIL, every test on a 405 or 404 for an unrouted POST.

- [ ] **Step 3: Write the latest-result reader**

Create `api/veodyn_api/services/publish_source.py`:

```python
"""The rows an attempt publishes, read from the query's last cached result.

Deliberately NOT `ai_grounding.query_result_columns`, which turns every failure
into `()` and says so in its own docstring. That economy is right for a hint
nobody acts on and wrong here: publishing bytes built from a result we could not
actually read is the failure this whole design exists to prevent. So this raises.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient


@dataclass(frozen=True)
class LatestResult:
    result_id: int
    rows: list[dict[str, Any]]
    # Epoch seconds. The engine never reads a clock, so the caller owns it, and
    # the honest value is when the DATA was retrieved rather than when the
    # button was pressed: the validator's freshness rules are about the feed.
    retrieved_at: int


def _epoch(raw: object) -> int:
    """Redash's ISO timestamp as epoch seconds, or now when it is unreadable.

    A missing or malformed `retrieved_at` is not worth refusing an attempt over:
    the header timestamp would then be wrong by minutes, where refusing makes
    the feed unpublishable. Falling back is recorded here so the choice is not
    mistaken for an oversight.
    """
    if isinstance(raw, str):
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(UTC)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return int(parsed.timestamp())
    return int(datetime.now(UTC).timestamp())


def latest_result(redash: RedashClient, query_id: int, api_key: str) -> LatestResult:
    """The query's last cached result. Raises when there is not one to publish.

    Two reads, the same pair `query_result_columns` makes: the query for its
    `latest_query_data_id`, then that result for its rows. Errors from the
    client (an unreadable query, Redash down) propagate as themselves, because
    "we could not ask" must never be reported as "there is nothing there".
    """
    query = redash.get_query(query_id, api_key=api_key)
    result_id = query.get("latest_query_data_id")
    if not isinstance(result_id, int):
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NO_RESULT,
            f"query {query_id} has no cached result yet, so there is nothing to publish",
            status_code=422,
        )

    payload = redash.get_query_result(result_id, api_key=api_key)
    result = payload.get("query_result")
    inner = result.get("data") if isinstance(result, dict) else None
    rows = inner.get("rows") if isinstance(inner, dict) else None
    if not isinstance(rows, list):
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NO_RESULT,
            f"the cached result for query {query_id} carries no rows",
            status_code=422,
        )

    retrieved_at = result.get("retrieved_at") if isinstance(result, dict) else None
    return LatestResult(
        result_id=result_id,
        rows=[row for row in rows if isinstance(row, dict)],
        retrieved_at=_epoch(retrieved_at),
    )
```

- [ ] **Step 4: Add the error id**

In `api/veodyn_api/errors.py`, append to the `ErrorId` enum, after the existing published-feed members (they are appended, never inserted):

```python
    PUBLISHED_FEED_NO_RESULT = "VEODYN_PUBLISHED_FEED_NO_RESULT"
```

- [ ] **Step 5: Write the production validator factory**

Create `api/veodyn_api/services/publish_validator.py`:

```python
"""The `Validate` the engine is given in production.

The engine takes validation as a parameter so a test can pass one. Nothing had
ever built the real one, because the worker that would have needed it ships in
the enterprise pack. The publish-now endpoint needs it, so it lives here rather
than in the router: what a verdict costs and how it fails closed is a service
decision, not a routing one.
"""

import httpx

from veodyn_api.services.feed_validator import VALIDATE_TIMEOUT_SECONDS, ValidatorUnavailable, validate_feed
from veodyn_api.services.publish_engine import Validate
from veodyn_api.settings import Settings


def build_validate(settings: Settings) -> Validate:
    """A validator bound to this deployment's configuration.

    An unset URL raises rather than returning a clean verdict. The engine turns
    that into a `failed` attempt, which is the whole point: a community
    deployment with no validator configured must not publish bytes nothing
    checked, and `settings.py` already says so about this field.
    """
    base_url = settings.feed_validator_url

    def validate(feed_bytes: bytes, static_gtfs_ref: str, previous_feed: bytes | None) -> object:
        if not base_url:
            raise ValidatorUnavailable("no feed validator is configured for this deployment")
        with httpx.Client(timeout=VALIDATE_TIMEOUT_SECONDS) as client:
            return validate_feed(client, base_url, feed_bytes, static_gtfs_ref, previous_feed)

    return validate  # type: ignore[return-value]
```

If `mypy` rejects the `object` return annotation, type it `ValidationOutcome` and import it from `veodyn_api.services.feed_validator`; then the `type: ignore` comes off. Prefer that spelling and only fall back if the import cycles.

- [ ] **Step 6: Add the endpoint**

In `api/veodyn_api/routers/published_feed_attempts.py` (created in Step 0), add the imports and handler in one edit, importing `load_feed` and `require_admin` from `published_feeds`:

```python
@router.post("/{slug}/attempts", response_model=PublishAttemptOut, status_code=201)
def publish_now(
    identity: IdentityDep, db: DbDep, redash: RedashDep, settings: SettingsDep, slug: str
) -> PublishAttemptOut:
    """Run one attempt for this feed, now.

    201 for every decision the engine reaches, including `blocked` and `failed`:
    the attempt was created, which is what this endpoint promises, and its
    decision is the answer rather than the status code. A 4xx here is reserved
    for the cases where no attempt happens at all.

    `run_attempt` records and commits the row itself, so nothing here commits.
    """
    require_admin(identity)
    feed = load_feed(db, identity.org_slug, slug)

    # Before the engine, because a query with no cached result is not a failed
    # attempt: there were no bytes to judge, and recording one would put a
    # failure against the binding for something the binding did not do.
    source = latest_result(redash, feed.query_id, settings.redash_service_api_key)

    run_attempt(
        db,
        feed,
        source.rows,
        query_result_id=source.result_id,
        feed_timestamp=source.retrieved_at,
        validate=build_validate(settings),
    )

    recorded = db.execute(
        select(PublishAttempt)
        .options(defer(PublishAttempt.feed_bytes))
        .where(PublishAttempt.org_slug == feed.org_slug, PublishAttempt.slug == feed.slug)
        .order_by(PublishAttempt.attempt_id.desc())
        .limit(1)
    ).scalar_one()
    return _attempt_out(recorded)
```

- [ ] **Step 7: Register the two new modules as community**

In `api/tests/ce_module_allowlist.json`, add `"services/publish_source.py"` and `"services/publish_validator.py"` to the `retained` list, in sorted position. The file's own comment says adding a community module is meant to be a decision; these two are community because the endpoint that uses them is.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_publish_now_route.py tests/test_published_feed_attempts_route.py -v`
Expected: PASS. If `test_a_missing_validator_fails_closed` fails because the fixture app has a validator URL set, confirm `api` does not set `VEODYN_FEED_VALIDATOR_URL` and that `get_settings.cache_clear()` ran.

- [ ] **Step 9: Regenerate and run the full gate**

Run, from `app/`: `pnpm gen:api-types`
Run, from `api/`: `uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api && uv run pytest`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add api app/src/types/generated/veodyn-api.d.ts
git commit -m "feat(api): run one publish attempt from a request, and fail closed without a validator"
```

---

### Task 3: Pin the field vocabulary so the frontend copy cannot drift silently

**Files:**
- Create: `api/tests/gtfs_field_vocabulary.json`
- Create: `api/tests/test_gtfs_field_vocabulary.py`

**Interfaces:**
- Consumes: `REQUIRED_FIELDS`, `SUPPORTED_FIELDS` from `services/gtfs_rt_serializer.py`.
- Produces: nothing importable. Task 8 writes the frontend copy this pins.

Why this exists: `columnMap` is `{[key: string]: string}` on the wire and nothing exposes the serializer's two frozensets, so the mapping editor's closed set has to be hand-written in `app/`. A drifting copy offers a field the serializer refuses, which is the silent drift `check_column_map`'s docstring warns about. Same shape and intent as `ce_module_allowlist.json`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_gtfs_field_vocabulary.py`:

```python
"""The field vocabulary the frontend was written against.

The mapping editor in `app/src/lib/gtfs-fields.ts` offers exactly these fields
and marks exactly these as required. Nothing on the wire carries them, so the
two copies are held together here rather than by a type.

If this fails, you changed the serializer. Update `app/src/lib/gtfs-fields.ts`
in the same change, then update this file. Updating only this file makes the
picker offer a field nothing writes, or hide one that now works.
"""

import json
from pathlib import Path

from veodyn_api.services.gtfs_rt_serializer import REQUIRED_FIELDS, SUPPORTED_FIELDS

VOCABULARY = json.loads((Path(__file__).parent / "gtfs_field_vocabulary.json").read_text())


def test_the_required_fields_are_the_ones_the_frontend_marks_required() -> None:
    expected = {entity: sorted(fields) for entity, fields in VOCABULARY["required"].items()}
    actual = {entity: sorted(fields) for entity, fields in REQUIRED_FIELDS.items()}
    assert actual == expected


def test_the_supported_fields_are_the_ones_the_frontend_offers() -> None:
    expected = {entity: sorted(fields) for entity, fields in VOCABULARY["supported"].items()}
    actual = {entity: sorted(fields) for entity, fields in SUPPORTED_FIELDS.items()}
    assert actual == expected
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd api && uv run pytest tests/test_gtfs_field_vocabulary.py -v`
Expected: FAIL with `FileNotFoundError` for `gtfs_field_vocabulary.json`.

- [ ] **Step 3: Write the ratchet file**

Create `api/tests/gtfs_field_vocabulary.json`:

```json
{
  "_comment": [
    "The GTFS-Realtime field vocabulary, as a ratchet against the frontend.",
    "app/src/lib/gtfs-fields.ts offers exactly these fields and marks exactly",
    "these as required, and nothing on the wire carries them, so this file is",
    "what holds the two copies together. Changing the serializer fails",
    "test_gtfs_field_vocabulary.py; update the frontend in the same change,",
    "then update this. Same shape and intent as ce_module_allowlist.json."
  ],
  "required": {
    "vehicle_positions": ["latitude", "longitude", "vehicle_id"]
  },
  "supported": {
    "vehicle_positions": [
      "bearing",
      "latitude",
      "longitude",
      "route_id",
      "speed",
      "timestamp",
      "trip_id",
      "vehicle_id"
    ]
  }
}
```

- [ ] **Step 4: Run it to verify it passes, then prove it can fail**

Run: `cd api && uv run pytest tests/test_gtfs_field_vocabulary.py -v`
Expected: PASS, 2 tests.

Now prove the guard works: temporarily add `"heading"` to the `supported` list in the JSON, re-run, and confirm both the failure and that the message names the mismatch. Revert the edit.

- [ ] **Step 5: Commit**

```bash
git add api/tests/gtfs_field_vocabulary.json api/tests/test_gtfs_field_vocabulary.py
git commit -m "test(api): pin the GTFS field vocabulary the frontend picker is written against"
```

---

### Task 4: The proxy routes

**Files:**
- Create: `app/src/app/api/published-feeds/route.ts`
- Create: `app/src/app/api/published-feeds/[slug]/route.ts`
- Create: `app/src/app/api/published-feeds/[slug]/attempts/route.ts`
- Create: `app/src/app/api/published-feeds/route.test.ts`
- Create: `app/src/app/api/published-feeds/[slug]/attempts/route.test.ts`

**Interfaces:**
- Consumes: the endpoints from Tasks 1 and 2.
- Produces: the same-origin paths `/api/published-feeds`, `/api/published-feeds/{slug}`, `/api/published-feeds/{slug}/attempts`, which Task 5's client calls.

Pattern to follow exactly: `app/src/app/api/feeds/route.ts`. Config from `@/lib/env` only, the caller's `cookie` and `authorization` forwarded verbatim, `signal: request.signal` on every upstream fetch, upstream status and body passed through unchanged, 204 and empty bodies answered with a null body, 503 when unconfigured, 502 when unreachable, and `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/app/api/published-feeds/route.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function load() {
  vi.resetModules()
  return import('./route')
}

describe('the published-feeds proxy', () => {
  it('answers 503 when no sidecar is configured', async () => {
    vi.stubEnv('CATALOG_API_URL', '')
    vi.stubEnv('KPI_API_URL', '')
    vi.stubEnv('REPORTS_API_URL', '')
    const { GET } = await load()

    const res = await GET(new Request('http://localhost/api/published-feeds'))

    expect(res.status).toBe(503)
  })

  it('forwards the caller credential and passes the upstream body through', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ slug: 'vehicles' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await load()

    const res = await GET(
      new Request('http://localhost/api/published-feeds', { headers: { cookie: 'session=ada' } })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ slug: 'vehicles' }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://sidecar:8000/published-feeds')
    expect((init as RequestInit & { headers: Record<string, string> }).headers.cookie).toBe('session=ada')
  })

  it('preserves a refusal body so the form can put it on the right field', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { id: 'VEODYN_PUBLISHED_FEED_SLUG_TAKEN', message: 'taken' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    const { POST } = await load()

    const res = await POST(
      new Request('http://localhost/api/published-feeds', { method: 'POST', body: '{}' })
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error.id).toBe('VEODYN_PUBLISHED_FEED_SLUG_TAKEN')
  })

  it('answers 502 when the sidecar is unreachable', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const { GET } = await load()

    const res = await GET(new Request('http://localhost/api/published-feeds'))

    expect(res.status).toBe(502)
  })
})
```

Create `app/src/app/api/published-feeds/[slug]/attempts/route.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('the attempts proxy', () => {
  it('encodes the slug into the upstream path', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { GET } = await import('./route')

    await GET(new Request('http://localhost/api/published-feeds/a%2Fb/attempts'), {
      params: Promise.resolve({ slug: 'a/b' }),
    })

    expect(fetchMock.mock.calls[0][0]).toBe('http://sidecar:8000/published-feeds/a%2Fb/attempts')
  })

  it('posts an attempt and returns the recorded decision', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ decision: 'blocked' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    vi.resetModules()
    const { POST } = await import('./route')

    const res = await POST(new Request('http://localhost/x', { method: 'POST' }), {
      params: Promise.resolve({ slug: 'vehicles' }),
    })

    expect(res.status).toBe(201)
    expect((await res.json()).decision).toBe('blocked')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && pnpm vitest run src/app/api/published-feeds`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the shared forwarder and the collection route**

The forwarding helpers go in their own module, NOT exported from `route.ts`. Next type-checks route files against a fixed set of exports, so an extra named export from `route.ts` risks a build-time "invalid export" error, and the two nested routes need these helpers.

Create `app/src/app/api/published-feeds/forward.ts`:

```ts
/**
 * Same-origin forwarding for the published-feed proxy routes.
 *
 * The base is resolved from three variables rather than one for the reason
 * ../favorites/route.ts gives: helm points all of them at the same sidecar, and
 * taking only one breaks an instance that happened to configure a different
 * half. CATALOG_API_URL leads because /feeds next door already uses it.
 *
 * Refusal bodies are passed through untouched. The 422 these endpoints answer
 * names every problem with a column map, and the form puts each one on its own
 * field, so collapsing it into a status code would throw away the diagnostic.
 */

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

export function sidecarBase(): string | null {
  const url = env.CATALOG_API_URL || env.KPI_API_URL || env.REPORTS_API_URL
  return url?.replace(/\/+$/, '') || null
}

// The caller's own credentials, so the sidecar resolves the same identity
// Redash would and enforces the admin check itself.
export function forwardedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const cookie = request.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  return headers
}

export async function forward(request: Request, path: string, init?: RequestInit) {
  const base = sidecarBase()
  if (!base) {
    return NextResponse.json({ error: 'no sidecar URL configured' }, { status: 503 })
  }
  try {
    const upstream = await fetch(`${base}${path}`, {
      ...init,
      signal: request.signal,
      headers: { ...forwardedHeaders(request), ...(init?.headers as Record<string, string>) },
    })
    const body = await upstream.text()
    if (upstream.status === 204 || body === '') {
      return new NextResponse(null, { status: upstream.status })
    }
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'published feed backend unreachable' }, { status: 502 })
  }
}

```

Then create `app/src/app/api/published-feeds/route.ts`, which holds only handlers:

```ts
/** The binding collection. Forwarding rules live in ./forward.ts. */

import { forward } from './forward'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return forward(request, '/published-feeds')
}

export async function POST(request: Request) {
  const body = await request.text()
  return forward(request, '/published-feeds', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 4: Write the item and attempts routes**

Create `app/src/app/api/published-feeds/[slug]/route.ts`:

```ts
/** One binding: read, replace, retire. See ../forward.ts for the forwarding rules. */

import { forward } from '../forward'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}`)
}

export async function PUT(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  const body = await request.text()
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/json' },
  })
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}`, { method: 'DELETE' })
}
```

Create `app/src/app/api/published-feeds/[slug]/attempts/route.ts`:

```ts
/** The publish record, and the control that adds to it. */

import { forward } from '../../forward'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}/attempts`)
}

// No body. What to publish is the binding's business, not the caller's.
export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}/attempts`, { method: 'POST' })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && pnpm vitest run src/app/api/published-feeds`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the gate**

Run, from `app/`: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/api/published-feeds
git commit -m "feat(app): proxy the published-feed endpoints, preserving their refusal bodies"
```

---

### Task 5: View types, the service client, hooks, and mock fixtures

**Files:**
- Create: `app/src/types/published-feed.ts`
- Create: `app/src/types/published-feed.contract.test.ts`
- Create: `app/src/services/published-feeds/client.ts`
- Create: `app/src/hooks/use-published-feeds.ts`
- Create: `app/src/hooks/use-published-feeds.test.tsx`
- Create: `app/src/stores/published-feed-slice.ts`
- Modify: `app/src/lib/errorIds.ts`
- Modify: `app/src/stores/mock-data-store.ts`
- Modify: `app/src/lib/mock-data.ts`

**Interfaces:**
- Consumes: the proxy paths from Task 4.
- Produces: types `PublishedFeed`, `PublishedFeedInput`, `PublishAttempt`, `PublishFinding`; client functions `fetchPublishedFeeds`, `fetchPublishedFeed`, `createPublishedFeed`, `updatePublishedFeed`, `deletePublishedFeed`, `fetchAttempts`, `publishNow`; hooks `usePublishedFeeds()`, `usePublishedFeed(slug)`, `useAttempts(slug)`, `useCreatePublishedFeed()`, `useUpdatePublishedFeed()`, `useDeletePublishedFeed()`, `usePublishNow()`.

- [ ] **Step 1: Write the view types and their contract test**

Create `app/src/types/published-feed.ts`:

```ts
// The published-feed surface, mirroring PublishedFeedIn / PublishedFeedOut and
// PublishAttemptOut in api/veodyn_api/schemas/published_feed.py. Hand-written
// rather than imported from the generated declaration, which is the convention
// every other domain here follows; published-feed.contract.test.ts is what
// keeps the two from drifting.

/** One validator finding, flattened to one occurrence. */
export interface PublishFinding {
  ruleId: string
  severity: string
  title: string
  locator: string
}

export interface PublishAttempt {
  attemptId: number
  bindingRevision: number
  queryResultId: number
  // A blocked attempt is the mapping or the data. A failed one is the
  // machinery, and carries a sentence instead of findings.
  decision: 'published' | 'blocked' | 'failed'
  reason: string
  findings: PublishFinding[]
  enabledRules: string[]
  /** The served artifact. At most one attempt per feed carries it. */
  isCurrent: boolean
  createdAt: string
}

/** What a write sends. Every field, every time: the endpoint is a PUT. */
export interface PublishedFeedInput {
  slug: string
  queryId: number
  standard: 'gtfs-rt'
  version: '2.0'
  entity: 'vehicle_positions'
  staticGtfsRef: string
  sourceColumn: string | null
  columnMap: Record<string, string>
  onError: 'block' | 'last_good'
  lastGoodMaxAgeSeconds: number | null
  visibility: 'private' | 'public'
}

export interface PublishedFeed extends PublishedFeedInput {
  revision: number
  // Only ever fresh in a write response. Both read paths hard-code `unknown`,
  // so no read path may render this as mapping validity.
  bindingState: string
}
```

Create `app/src/types/published-feed.contract.test.ts`:

```ts
// Checked by `pnpm exec tsc --noEmit`, NOT by `vitest run`: expectTypeOf
// compiles to nothing and this file is .test.ts, not .test-d.ts. The same
// caveat is written out in generated/veodyn-api.contract.test.ts.
import { describe, expectTypeOf, it } from 'vitest'
import type { components } from './generated/veodyn-api'
import type { PublishAttempt, PublishedFeed, PublishedFeedInput } from './published-feed'

describe('published-feed contract', () => {
  // Asserted in this direction because the wire widens every enum to `string`,
  // so the wire type does not extend ours. Ours extending the wire's is what
  // catches the drift that matters: a renamed or removed field.
  it('the app feed is a valid PublishedFeedOut', () => {
    expectTypeOf<PublishedFeed>().toExtend<components['schemas']['PublishedFeedOut']>()
  })

  it('the app input is a valid PublishedFeedIn', () => {
    expectTypeOf<PublishedFeedInput>().toExtend<components['schemas']['PublishedFeedIn']>()
  })

  it('the app attempt is a valid PublishAttemptOut', () => {
    expectTypeOf<PublishAttempt>().toExtend<components['schemas']['PublishAttemptOut']>()
  })

  // Keys both ways, so a field ADDED to the wire fails here too.
  it('the feed carries exactly the keys the wire does', () => {
    expectTypeOf<keyof PublishedFeed>().toEqualTypeOf<
      keyof components['schemas']['PublishedFeedOut']
    >()
  })

  it('the attempt carries exactly the keys the wire does', () => {
    expectTypeOf<keyof PublishAttempt>().toEqualTypeOf<
      keyof components['schemas']['PublishAttemptOut']
    >()
  })
})
```

- [ ] **Step 2: Add the error cause**

In `app/src/lib/errorIds.ts`, add to the `ErrorIds` object beside `CATALOG_FETCH_FAILED`:

```ts
  PUBLISHED_FEED_REQUEST_FAILED: 'E_PUBFEED_001',
```

- [ ] **Step 3: Write the service client**

Create `app/src/services/published-feeds/client.ts`:

```ts
// Published-feed client. Calls the same-origin /api/published-feeds proxy
// routes, never the sidecar directly.
//
// The refusal body is deliberately carried into the thrown error rather than
// flattened to a status. A 422 from this endpoint names every problem with a
// column map in one message, and the form puts each on its own field.

import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type { PublishAttempt, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'

function wrapError(error: unknown): Error {
  if (isAppError(error)) return error
  // By name rather than instanceof: the abort error comes from a different
  // realm than the environment's DOMException in tests.
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.PUBLISHED_FEED_REQUEST_FAILED, 'published feed request failed', {
    cause: error instanceof Error ? error.message : String(error),
  })
}

async function refusal(res: Response, fallback: string): Promise<AppError> {
  // The sidecar's envelope is { error: { id, message } }. A proxy 502 or 503 is
  // plain JSON with an `error` string, so both shapes are read here.
  let message = fallback
  let errorId: string | undefined
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') message = body.error
    if (typeof body?.error?.message === 'string') message = body.error.message
    if (typeof body?.error?.id === 'string') errorId = body.error.id
  } catch {
    // A body that is not JSON tells us nothing the status has not.
  }
  return new AppError(ErrorIds.PUBLISHED_FEED_REQUEST_FAILED, message, { status: res.status, errorId })
}

export async function fetchPublishedFeeds(opts: { signal?: AbortSignal } = {}): Promise<PublishedFeed[]> {
  try {
    const res = await fetch('/api/published-feeds', { credentials: 'include', signal: opts.signal })
    if (!res.ok) throw await refusal(res, `published feeds fetch failed (${res.status})`)
    return (await res.json()) as PublishedFeed[]
  } catch (error) {
    throw wrapError(error)
  }
}

export async function fetchPublishedFeed(
  slug: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishedFeed | null> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: opts.signal,
    })
    if (res.status === 404) return null
    if (!res.ok) throw await refusal(res, `published feed fetch failed (${res.status})`)
    return (await res.json()) as PublishedFeed
  } catch (error) {
    throw wrapError(error)
  }
}

export async function createPublishedFeed(
  input: PublishedFeedInput,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishedFeed> {
  try {
    const res = await fetch('/api/published-feeds', {
      method: 'POST',
      credentials: 'include',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw await refusal(res, `could not publish this feed (${res.status})`)
    return (await res.json()) as PublishedFeed
  } catch (error) {
    throw wrapError(error)
  }
}

export async function updatePublishedFeed(
  slug: string,
  input: PublishedFeedInput,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishedFeed> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      credentials: 'include',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw await refusal(res, `could not save this feed (${res.status})`)
    return (await res.json()) as PublishedFeed
  } catch (error) {
    throw wrapError(error)
  }
}

export async function deletePublishedFeed(slug: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      credentials: 'include',
      signal: opts.signal,
    })
    if (!res.ok) throw await refusal(res, `could not retire this feed (${res.status})`)
  } catch (error) {
    throw wrapError(error)
  }
}

export async function fetchAttempts(
  slug: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishAttempt[]> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}/attempts`, {
      credentials: 'include',
      signal: opts.signal,
    })
    if (!res.ok) throw await refusal(res, `attempt history fetch failed (${res.status})`)
    return (await res.json()) as PublishAttempt[]
  } catch (error) {
    throw wrapError(error)
  }
}

export async function publishNow(
  slug: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PublishAttempt> {
  try {
    const res = await fetch(`/api/published-feeds/${encodeURIComponent(slug)}/attempts`, {
      method: 'POST',
      credentials: 'include',
      signal: opts.signal,
    })
    if (!res.ok) throw await refusal(res, `could not run a publish attempt (${res.status})`)
    return (await res.json()) as PublishAttempt
  } catch (error) {
    throw wrapError(error)
  }
}
```

If `AppError`'s context type does not accept `errorId`, read `app/src/lib/errorIds.ts` and use whichever key it already carries for this; do not widen the type.

- [ ] **Step 4: Write the mock slice and its fixtures**

Create `app/src/stores/published-feed-slice.ts`:

```ts
import type { StateCreator } from 'zustand'
import { mockPublishedFeeds, mockPublishAttempts } from '@/lib/mock-data'
import type { PublishAttempt, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'
import type { MockDataState } from './mock-data-store'

// Mock mode issues no request at all, so without this slice every page in
// /connect/feeds is blank in dev and in both demo packs.
export interface PublishedFeedSlice {
  publishedFeeds: PublishedFeed[]
  publishAttempts: Record<string, PublishAttempt[]>
  createPublishedFeed: (input: PublishedFeedInput) => PublishedFeed
  updatePublishedFeed: (slug: string, input: PublishedFeedInput) => PublishedFeed
  deletePublishedFeed: (slug: string) => void
  recordPublishAttempt: (slug: string) => PublishAttempt
}

const nextAttemptId = (existing: PublishAttempt[]) =>
  existing.reduce((highest, attempt) => Math.max(highest, attempt.attemptId), 0) + 1

export const createPublishedFeedSlice: StateCreator<MockDataState, [], [], PublishedFeedSlice> = (
  set,
  get
) => ({
  publishedFeeds: [...mockPublishedFeeds],
  publishAttempts: { ...mockPublishAttempts },

  createPublishedFeed: (input) => {
    const feed: PublishedFeed = { ...input, revision: 1, bindingState: 'ok' }
    set((s) => ({ publishedFeeds: [...s.publishedFeeds, feed] }))
    return feed
  },

  updatePublishedFeed: (slug, input) => {
    const existing = get().publishedFeeds.find((f) => f.slug === slug)
    const feed: PublishedFeed = {
      ...input,
      revision: (existing?.revision ?? 0) + 1,
      bindingState: 'ok',
    }
    // The revision bump takes the feed off the air, exactly as the endpoint
    // does, so mock mode shows the same dark window the real one produces.
    set((s) => ({
      publishedFeeds: s.publishedFeeds.map((f) => (f.slug === slug ? feed : f)),
      publishAttempts: {
        ...s.publishAttempts,
        [slug]: (s.publishAttempts[slug] ?? []).map((a) => ({ ...a, isCurrent: false })),
      },
    }))
    return feed
  },

  deletePublishedFeed: (slug) =>
    set((s) => ({
      publishedFeeds: s.publishedFeeds.filter((f) => f.slug !== slug),
      publishAttempts: Object.fromEntries(
        Object.entries(s.publishAttempts).filter(([key]) => key !== slug)
      ),
    })),

  recordPublishAttempt: (slug) => {
    const existing = get().publishAttempts[slug] ?? []
    const feed = get().publishedFeeds.find((f) => f.slug === slug)
    const attempt: PublishAttempt = {
      attemptId: nextAttemptId(existing),
      bindingRevision: feed?.revision ?? 1,
      queryResultId: 500 + existing.length,
      decision: 'published',
      reason: '',
      findings: [],
      enabledRules: ['E003'],
      isCurrent: true,
      createdAt: new Date().toISOString(),
    }
    set((s) => ({
      publishAttempts: {
        ...s.publishAttempts,
        [slug]: [attempt, ...(s.publishAttempts[slug] ?? []).map((a) => ({ ...a, isCurrent: false }))],
      },
    }))
    return attempt
  },
})
```

Add to `app/src/lib/mock-data.ts` (append near the other exported fixtures):

```ts
export const mockPublishedFeeds: PublishedFeed[] = [
  {
    slug: 'vehicles-live',
    revision: 3,
    queryId: 1,
    standard: 'gtfs-rt',
    version: '2.0',
    entity: 'vehicle_positions',
    staticGtfsRef: 'https://example.org/gtfs.zip',
    sourceColumn: null,
    columnMap: { vehicle_id: 'bus', latitude: 'lat', longitude: 'lon' },
    onError: 'block',
    lastGoodMaxAgeSeconds: null,
    visibility: 'public',
    bindingState: 'unknown',
  },
]

export const mockPublishAttempts: Record<string, PublishAttempt[]> = {
  'vehicles-live': [
    {
      attemptId: 2,
      bindingRevision: 3,
      queryResultId: 501,
      decision: 'published',
      reason: '',
      findings: [],
      enabledRules: ['E002', 'E003'],
      isCurrent: true,
      createdAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    },
    {
      attemptId: 1,
      bindingRevision: 3,
      queryResultId: 500,
      decision: 'blocked',
      reason: '2 conformance error(s)',
      findings: [
        { ruleId: 'E003', severity: 'ERROR', title: 'GTFS-rt trip_id does not exist', locator: 'entity 0' },
        { ruleId: 'E003', severity: 'ERROR', title: 'GTFS-rt trip_id does not exist', locator: 'entity 4' },
      ],
      enabledRules: ['E002', 'E003'],
      isCurrent: false,
      createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    },
  ],
}
```

Wire it into `app/src/stores/mock-data-store.ts` in one edit: import `createPublishedFeedSlice, type PublishedFeedSlice`, intersect `PublishedFeedSlice` into `MockDataState`, and spread `...createPublishedFeedSlice(set, get, store)` beside `createFeedSlice`.

- [ ] **Step 5: Write the hooks**

Create `app/src/hooks/use-published-feeds.ts`:

```ts
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import { withFixtureFallback } from '@/lib/backend-fallback'
import { useMockDataStore } from '@/stores/mock-data-store'
import {
  createPublishedFeed,
  deletePublishedFeed,
  fetchAttempts,
  fetchPublishedFeed,
  fetchPublishedFeeds,
  publishNow,
  updatePublishedFeed,
} from '@/services/published-feeds/client'
import type { PublishAttempt, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'

const LIST_KEY = ['published-feeds']
const feedKey = (slug: string) => ['published-feeds', slug]
const attemptsKey = (slug: string) => ['published-feeds', slug, 'attempts']

export function usePublishedFeeds() {
  const feeds = useMockDataStore((s) => s.publishedFeeds)
  return useQuery({
    queryKey: LIST_KEY,
    // The sidecar 503s until its URL is set, which is the agreed "not wired
    // yet" signal. Only a 503 falls back; a 4xx or 5xx from a configured
    // backend is a real failure and must surface.
    queryFn: async ({ signal }) =>
      USE_REAL_API ? withFixtureFallback(() => fetchPublishedFeeds({ signal }), () => feeds) : feeds,
  })
}

export function usePublishedFeed(slug: string | undefined) {
  const feeds = useMockDataStore((s) => s.publishedFeeds)
  return useQuery({
    queryKey: feedKey(slug ?? ''),
    enabled: slug != null,
    queryFn: async ({ signal }): Promise<PublishedFeed | null> => {
      const fixture = () => feeds.find((f) => f.slug === slug) ?? null
      if (!USE_REAL_API) return fixture()
      return withFixtureFallback(() => fetchPublishedFeed(slug as string, { signal }), fixture)
    },
  })
}

export function useAttempts(slug: string | undefined) {
  const attempts = useMockDataStore((s) => s.publishAttempts)
  return useQuery({
    queryKey: attemptsKey(slug ?? ''),
    enabled: slug != null,
    queryFn: async ({ signal }): Promise<PublishAttempt[]> => {
      const fixture = () => attempts[slug as string] ?? []
      if (!USE_REAL_API) return fixture()
      return withFixtureFallback(() => fetchAttempts(slug as string, { signal }), fixture)
    },
  })
}

export function useCreatePublishedFeed() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (input: PublishedFeedInput) =>
      USE_REAL_API ? createPublishedFeed(input) : store.createPublishedFeed(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export function useUpdatePublishedFeed() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (vars: { slug: string; input: PublishedFeedInput }) =>
      USE_REAL_API
        ? updatePublishedFeed(vars.slug, vars.input)
        : store.updatePublishedFeed(vars.slug, vars.input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      qc.invalidateQueries({ queryKey: feedKey(vars.slug) })
      // The edit cleared the served pointer, so the history on screen is stale
      // in the one way that matters: it still shows something as serving.
      qc.invalidateQueries({ queryKey: attemptsKey(vars.slug) })
    },
  })
}

export function useDeletePublishedFeed() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (slug: string) =>
      USE_REAL_API ? deletePublishedFeed(slug) : store.deletePublishedFeed(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export function usePublishNow() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (slug: string) => (USE_REAL_API ? publishNow(slug) : store.recordPublishAttempt(slug)),
    onSuccess: (_data, slug) => qc.invalidateQueries({ queryKey: attemptsKey(slug) }),
  })
}
```

- [ ] **Step 6: Write the hook test**

Create `app/src/hooks/use-published-feeds.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useAttempts, usePublishNow, usePublishedFeeds } from './use-published-feeds'

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('published feed hooks in mock mode', () => {
  it('lists the fixture feeds', async () => {
    const { result } = renderHook(() => usePublishedFeeds(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.[0].slug).toBe('vehicles-live')
  })

  it('reads a feed history newest first', async () => {
    const { result } = renderHook(() => useAttempts('vehicles-live'), { wrapper })
    await waitFor(() => expect(result.current.data?.length).toBe(2))
    expect(result.current.data?.[0].decision).toBe('published')
    expect(result.current.data?.[0].isCurrent).toBe(true)
  })

  it('an attempt supersedes whatever was serving', async () => {
    const { result } = renderHook(() => usePublishNow(), { wrapper })
    await result.current.mutateAsync('vehicles-live')

    const history = useMockDataStore.getState().publishAttempts['vehicles-live']
    expect(history.filter((a) => a.isCurrent)).toHaveLength(1)
    expect(history[0].attemptId).toBe(3)
  })
})
```

- [ ] **Step 7: Run the tests and the gate**

Run: `cd app && pnpm vitest run src/hooks/use-published-feeds.test.tsx`
Expected: PASS, 3 tests.
Run: `cd app && pnpm lint && pnpm exec tsc --noEmit`
Expected: clean. `tsc` is what checks the contract test, so a wire mismatch shows up here and nowhere else.

- [ ] **Step 8: Commit**

```bash
git add app/src/types app/src/services/published-feeds app/src/hooks/use-published-feeds.ts app/src/hooks/use-published-feeds.test.tsx app/src/stores app/src/lib/errorIds.ts app/src/lib/mock-data.ts
git commit -m "feat(app): the published-feed data layer, pinned to the wire by a contract test"
```

---

### Task 6: The list page and its nav row

**Files:**
- Create: `app/src/components/published-feeds/serving-status.tsx`
- Create: `app/src/app/connect/feeds/page.tsx`
- Create: `app/src/app/connect/feeds/loading.tsx`
- Create: `app/src/app/connect/feeds/page.test.tsx`
- Create: `app/src/app/connect/feeds/page.backend-failure.test.tsx`
- Create: `app/src/app/connect/feeds/connect-feeds.restyle.test.ts`
- Modify: `app/src/lib/sidebar-nav.ts`
- Modify: `app/src/lib/sidebar-nav.test.ts`

**Interfaces:**
- Consumes: `usePublishedFeeds` from Task 5.
- Produces: `ServingStatus` (props `{ attempt: PublishAttempt | undefined }`), reused by Task 7's detail header.

- [ ] **Step 1: Write the failing tests**

Create `app/src/app/connect/feeds/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import PublishedFeedsPage from './page'

afterEach(() => resetStores())

describe('the published feeds list', () => {
  it('lists each feed with its address and standard', async () => {
    renderWithProviders(<PublishedFeedsPage />)

    expect(screen.getByRole('heading', { name: 'Published Feeds' })).toBeInTheDocument()
    expect(await screen.findByText('vehicles-live')).toBeInTheDocument()
    expect(screen.getByText(/GTFS-Realtime/)).toBeInTheDocument()
  })

  it('offers publishing only to an administrator', async () => {
    renderWithProviders(<PublishedFeedsPage />)
    await screen.findByText('vehicles-live')
    expect(screen.queryByRole('link', { name: /publish a feed/i })).not.toBeInTheDocument()

    resetStores()
    signInAsAdmin()
    renderWithProviders(<PublishedFeedsPage />)
    expect(await screen.findByRole('link', { name: /publish a feed/i })).toBeInTheDocument()
  })

  it('says nothing is published rather than showing an empty table', async () => {
    useMockDataStore.setState({ publishedFeeds: [] })
    renderWithProviders(<PublishedFeedsPage />)

    expect(await screen.findByText(/No feeds are published/i)).toBeInTheDocument()
  })
})
```

Create `app/src/app/connect/feeds/page.backend-failure.test.tsx`:

```tsx
// An empty state is not an error state. Mock mode resolves from fixtures and
// can never be observed failing, so the hook is pinned instead.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'

vi.mock('@/hooks/use-published-feeds', () => ({
  usePublishedFeeds: () => ({ data: undefined, isLoading: false, isError: true, refetch: () => {} }),
}))

import PublishedFeedsPage from './page'

describe('the published feeds list when the sidecar fails', () => {
  it('says the list could not be read rather than that nothing is published', async () => {
    renderWithProviders(<PublishedFeedsPage />)

    expect(await screen.findByText(/could not be loaded|unable to load/i)).toBeInTheDocument()
    expect(screen.queryByText(/No feeds are published/i)).not.toBeInTheDocument()
  })
})
```

Create `app/src/app/connect/feeds/connect-feeds.restyle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = ['app/connect/feeds/page.tsx']

describe('the published feeds surface carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
```

Add to `app/src/lib/sidebar-nav.test.ts` a case asserting a CONNECT row for `/connect/feeds` exists, following whatever assertion style that file already uses for the APIs and MCP rows.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && pnpm vitest run src/app/connect/feeds src/lib/sidebar-nav.test.ts`
Expected: FAIL, cannot resolve `./page`.

- [ ] **Step 3: Write the status component**

Create `app/src/components/published-feeds/serving-status.tsx`:

```tsx
import { CircleCheck, CircleOff, CircleSlash, CircleHelp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PublishAttempt } from '@/types/published-feed'

// Serving state, which is NOT binding state. The binding's `bindingState` is
// only fresh in a write response (both read paths hard-code `unknown`), so
// nothing on a read path may render it as mapping validity. What a reader can
// be told honestly is whether anything is being served, and that comes from
// the attempt record.
//
// Status is icon plus word plus a semantic token, never colour alone, matching
// FEED_STATUS_META on the Feed Health board next door.
const META = {
  serving: { label: 'Serving', Icon: CircleCheck, text: 'text-status-fresh' },
  blocked: { label: 'Blocked', Icon: CircleSlash, text: 'text-destructive' },
  failed: { label: 'Failed', Icon: CircleOff, text: 'text-destructive' },
  never: { label: 'Never published', Icon: CircleHelp, text: 'text-muted-foreground' },
} as const

export type ServingState = keyof typeof META

export function servingState(attempt: PublishAttempt | undefined): ServingState {
  if (!attempt) return 'never'
  if (attempt.isCurrent) return 'serving'
  return attempt.decision === 'blocked' ? 'blocked' : 'failed'
}

export function ServingStatus({ attempt }: { attempt: PublishAttempt | undefined }) {
  const { label, Icon, text } = META[servingState(attempt)]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', text)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  )
}
```

Check that `text-status-fresh` exists as a token in this repo before using it; `app/src/lib/feed-status.ts` is where the Feed Health board's tokens are named. Reuse whatever it uses for a healthy state rather than inventing a token name.

- [ ] **Step 4: Write the list page**

Create `app/src/app/connect/feeds/page.tsx`. It renders `PageHeader` with title `Published Feeds`, a `ListToolbar` search, and an `ItemsTable` with columns: address (the slug plus the query it is bound to), standard (`GTFS-Realtime 2.0 · vehicle positions`), access (`visibility`), and revision. The action in the header is a `Button` wrapping a `Link` to `/connect/feeds/new`, rendered only when `useAuthStore((s) => s.currentUser)?.isAdmin` is true, with the accessible name "Publish a feed". `isError` renders `ListLoadError` with `noun="published feeds"` and `onRetry={() => refetch()}`; the empty message is `No feeds are published yet.`

The list has no serving column in this task: showing one would need an attempt read per row, which the list endpoint does not do and the page must not fake. Task 7 puts serving state on the detail page where a single read pays for it.

Create `app/src/app/connect/feeds/loading.tsx` mirroring `app/src/app/feed-health/loading.tsx`.

- [ ] **Step 5: Add the nav row**

In `app/src/lib/sidebar-nav.ts`, add to the CONNECT section's rows, after MCP:

```ts
        { label: 'Feeds', href: '/connect/feeds', icon: Radio },
```

Import `Radio` from `lucide-react` in the same edit. Not `Rss`: `/feed-health` already uses it, and two identical icons in one sidebar is worse than a second-choice glyph. The row is deliberately not admin-gated, because the API serves the list to any org member.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd app && pnpm vitest run src/app/connect/feeds src/lib/sidebar-nav.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the gate and commit**

Run: `cd app && pnpm lint && pnpm exec tsc --noEmit`

```bash
git add app/src/app/connect/feeds app/src/components/published-feeds app/src/lib/sidebar-nav.ts app/src/lib/sidebar-nav.test.ts
git commit -m "feat(app): list the published feeds under Connect"
```

---

### Task 7: The detail page, attempt history, and findings

**Files:**
- Create: `app/src/components/published-feeds/findings-list.tsx`
- Create: `app/src/components/published-feeds/attempt-history.tsx`
- Create: `app/src/app/connect/feeds/[slug]/page.tsx`
- Create: `app/src/app/connect/feeds/[slug]/loading.tsx`
- Create: `app/src/app/connect/feeds/[slug]/page.test.tsx`
- Modify: `app/src/app/connect/feeds/connect-feeds.restyle.test.ts` (add the new files)

**Interfaces:**
- Consumes: `usePublishedFeed`, `useAttempts`, `usePublishNow` from Task 5; `ServingStatus` from Task 6.
- Produces: `FindingsList` (props `{ findings: PublishFinding[] }`), `AttemptHistory` (props `{ attempts: PublishAttempt[] }`).

- [ ] **Step 1: Write the failing tests**

Create `app/src/app/connect/feeds/[slug]/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import FeedDetailPage from './page'

afterEach(() => resetStores())

const params = Promise.resolve({ slug: 'vehicles-live' })

describe('the published feed detail page', () => {
  it('reports what is serving, from the attempt record', async () => {
    renderWithProviders(<FeedDetailPage params={params} />)

    expect(await screen.findByText('Serving')).toBeInTheDocument()
  })

  it('never claims mapping validity on a read', async () => {
    // bindingState is `unknown` on every read path by design, so a green tick
    // here would be a claim nothing checked.
    renderWithProviders(<FeedDetailPage params={params} />)

    await screen.findByText('Serving')
    expect(screen.queryByText(/mapping ok/i)).not.toBeInTheDocument()
  })

  it('groups a blocked attempt findings by rule and counts the occurrences', async () => {
    renderWithProviders(<FeedDetailPage params={params} />)

    expect(await screen.findByText(/GTFS-rt trip_id does not exist/)).toBeInTheDocument()
    // Two occurrences of one rule collapse into one row, not two.
    expect(screen.getAllByText(/GTFS-rt trip_id does not exist/)).toHaveLength(1)
    expect(screen.getByText(/2 occurrences/i)).toBeInTheDocument()
  })

  it('shows a failed attempt reason and no findings list', async () => {
    useMockDataStore.setState({
      publishAttempts: {
        'vehicles-live': [
          {
            attemptId: 9,
            bindingRevision: 3,
            queryResultId: 700,
            decision: 'failed',
            reason: 'no feed validator is configured for this deployment',
            findings: [],
            enabledRules: [],
            isCurrent: false,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    })
    renderWithProviders(<FeedDetailPage params={params} />)

    expect(await screen.findByText(/no feed validator is configured/)).toBeInTheDocument()
    expect(screen.queryByText(/occurrences/i)).not.toBeInTheDocument()
  })

  it('offers publishing only to an administrator', async () => {
    renderWithProviders(<FeedDetailPage params={params} />)
    await screen.findByText('Serving')
    expect(screen.queryByRole('button', { name: /publish now/i })).not.toBeInTheDocument()

    resetStores()
    signInAsAdmin()
    renderWithProviders(<FeedDetailPage params={params} />)
    expect(await screen.findByRole('button', { name: /publish now/i })).toBeInTheDocument()
  })

  it('records an attempt when publish is pressed', async () => {
    signInAsAdmin()
    const user = userEvent.setup()
    renderWithProviders(<FeedDetailPage params={params} />)

    await user.click(await screen.findByRole('button', { name: /publish now/i }))

    await screen.findByText(/Serving/)
    expect(useMockDataStore.getState().publishAttempts['vehicles-live']).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && pnpm vitest run "src/app/connect/feeds/[slug]"`
Expected: FAIL, cannot resolve `./page`.

- [ ] **Step 3: Write the findings list**

Create `app/src/components/published-feeds/findings-list.tsx`:

```tsx
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from '@/components/ui/collapsible'
import type { PublishFinding } from '@/types/published-feed'

// `normalize_report` flattens the validator's report to one finding per
// occurrence, so a single broken rule arrives as many rows sharing a ruleId.
// Listing them raw reads as many problems when it is one, so they group here
// and the free-text locators sit behind a disclosure.
interface Rule {
  ruleId: string
  severity: string
  title: string
  locators: string[]
}

export function groupByRule(findings: PublishFinding[]): Rule[] {
  const byRule = new Map<string, Rule>()
  for (const finding of findings) {
    const existing = byRule.get(finding.ruleId)
    if (existing) {
      if (finding.locator) existing.locators.push(finding.locator)
      continue
    }
    byRule.set(finding.ruleId, {
      ruleId: finding.ruleId,
      severity: finding.severity,
      title: finding.title,
      locators: finding.locator ? [finding.locator] : [],
    })
  }
  return [...byRule.values()]
}

export function FindingsList({ findings }: { findings: PublishFinding[] }) {
  const rules = groupByRule(findings)
  if (rules.length === 0) return null
  return (
    <ul className="space-y-2">
      {rules.map((rule) => (
        <li key={rule.ruleId} className="rounded-md border p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{rule.title}</span>
            <span className="font-mono text-xs text-muted-foreground">{rule.ruleId}</span>
          </div>
          {rule.locators.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="mt-1 text-xs text-muted-foreground hover:text-foreground">
                {rule.locators.length} {rule.locators.length === 1 ? 'occurrence' : 'occurrences'}
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <ul className="mt-1 space-y-0.5">
                  {rule.locators.map((locator, index) => (
                    <li key={`${rule.ruleId}-${index}`} className="font-mono text-xs text-muted-foreground">
                      {locator}
                    </li>
                  ))}
                </ul>
              </CollapsiblePanel>
            </Collapsible>
          )}
        </li>
      ))}
    </ul>
  )
}
```

Read `app/src/components/ui/collapsible.tsx` for the exact export names before writing this; if they differ, use the names that file exports rather than adding an alias.

- [ ] **Step 4: Write the attempt history**

Create `app/src/components/published-feeds/attempt-history.tsx`. Each row shows `TimeAgo` on `createdAt`, the decision word, `rev N`, and a "serving" marker when `isCurrent`. Then, by decision:

- `blocked`: render `FindingsList`. Do not render `reason`, which is only the count.
- `failed`: render `reason` as one sentence. Do not render a findings list; there is nothing to enumerate.
- `published`: render nothing extra unless `findings` is non-empty, in which case render `FindingsList` under a heading saying these are warnings the feed published with.

- [ ] **Step 5: Write the detail page**

Create `app/src/app/connect/feeds/[slug]/page.tsx` following the three-branch convention from `app/src/app/destinations/[destinationId]/page.tsx`: `use(params)` for the slug, loading renders `SkeletonCard`, `isError` renders `NoData` saying the feed could not be loaded and may have been deleted or the request refused, a null result renders `NoData message="Feed not found."`.

The body: `PageHeader` with the slug as title and `ServingStatus` from the newest attempt in the header action area; a `Card` describing the binding (query id, standard, entity, static ref, on-error policy, visibility, revision, and the column map as a definition list); the `AttemptHistory`; and for admins a `Publish now` `Button` plus `Edit` and `Delete`.

Publish now is withheld, with a line saying the query has produced nothing new, when the newest attempt is `isCurrent` and no new query result exists. This task has no way to know the query's latest result id, so implement the control as always-enabled here and leave a comment pointing at Task 9, which adds the guard. Do not invent a result-id read.

Create `loading.tsx` beside it.

- [ ] **Step 6: Run the tests, the gate, and commit**

Run: `cd app && pnpm vitest run "src/app/connect/feeds"`
Run: `cd app && pnpm lint && pnpm exec tsc --noEmit`

```bash
git add app/src/app/connect/feeds app/src/components/published-feeds
git commit -m "feat(app): show what a published feed served, and why an attempt was refused"
```

---

### Task 8: The binding form and the create page

**Files:**
- Create: `app/src/lib/gtfs-fields.ts`
- Create: `app/src/components/published-feeds/query-picker.tsx`
- Create: `app/src/components/published-feeds/column-map-editor.tsx`
- Create: `app/src/components/published-feeds/feed-form.tsx`
- Create: `app/src/app/connect/feeds/new/page.tsx`
- Create: `app/src/app/connect/feeds/new/loading.tsx`
- Create: `app/src/app/connect/feeds/new/page.test.tsx`
- Create: `app/src/components/published-feeds/column-map-editor.test.tsx`

**Interfaces:**
- Consumes: `useCreatePublishedFeed` from Task 5; `useQueries({ search })` from `app/src/hooks/use-queries.ts`.
- Produces: `GTFS_FIELDS` (ordered list of `{ name, required }`), `QueryPicker`, `ColumnMapEditor`, `FeedForm`. Task 9 reuses `FeedForm`.

- [ ] **Step 1: Write the field vocabulary**

Create `app/src/lib/gtfs-fields.ts`:

```ts
// The closed set the mapping editor offers, mirroring REQUIRED_FIELDS and
// SUPPORTED_FIELDS in api/veodyn_api/services/gtfs_rt_serializer.py.
//
// Hand-written because nothing carries it on the wire: columnMap is a bare
// string map. api/tests/gtfs_field_vocabulary.json is the ratchet that fails
// the API suite if the serializer changes without this file changing with it.
//
// Required first, then optional, both in the order a person reading a vehicle
// position would expect rather than alphabetically.
export interface GtfsField {
  name: string
  required: boolean
}

export const GTFS_FIELDS: GtfsField[] = [
  { name: 'vehicle_id', required: true },
  { name: 'latitude', required: true },
  { name: 'longitude', required: true },
  { name: 'trip_id', required: false },
  { name: 'route_id', required: false },
  { name: 'bearing', required: false },
  { name: 'speed', required: false },
  { name: 'timestamp', required: false },
]

export const REQUIRED_GTFS_FIELDS = GTFS_FIELDS.filter((field) => field.required).map((f) => f.name)

/** What the create/edit form sends: mapped fields only, unmapped ones absent. */
export function toColumnMap(selection: Record<string, string | null>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const field of GTFS_FIELDS) {
    const column = selection[field.name]
    if (column) map[field.name] = column
  }
  return map
}

/** The problems the form can catch before it posts. */
export function missingRequired(selection: Record<string, string | null>): string[] {
  return REQUIRED_GTFS_FIELDS.filter((name) => !selection[name])
}
```

- [ ] **Step 2: Write the failing editor test**

Create `app/src/components/published-feeds/column-map-editor.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ColumnMapEditor } from './column-map-editor'

describe('the column map editor', () => {
  it('offers every supported field, required ones marked', () => {
    render(
      <ColumnMapEditor columns={['bus', 'lat', 'lon']} selection={{}} onChange={vi.fn()} />
    )

    expect(screen.getByText('vehicle_id')).toBeInTheDocument()
    expect(screen.getByText('timestamp')).toBeInTheDocument()
    // Required is stated in text, not by colour or an asterisk alone.
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0)
  })

  it('says so when the query has produced no columns to choose from', () => {
    render(<ColumnMapEditor columns={[]} selection={{}} onChange={vi.fn()} />)

    expect(screen.getByText(/has not produced a result yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Write the query picker**

Create `app/src/components/published-feeds/query-picker.tsx`, modelled on `app/src/components/dashboard/add-widget-search.tsx`: an `InputGroup` search box over `useQueries({ search: search || undefined })`, then a scrolling list of ghost `Button`s, one per query, calling `onSelect(query.id)`. Show the selected query's name with a "Change" control once one is picked, so the whole list is not on screen for the rest of the form.

- [ ] **Step 4: Write the column map editor**

Create `app/src/components/published-feeds/column-map-editor.tsx`: a `Table` with a row per `GTFS_FIELDS` entry. The left cell is the field name plus the word `required` for required ones; the right cell is a `Select` over `columns` with a "not mapped" option for optional fields. Use `Select` from `@/components/ui/select`, pass `items` explicitly because the options are query-backed (the primitive's own doc comment names this case), and guard `onValueChange` against `null`, which it can emit on clear.

When `columns` is empty, render one row of copy saying the query has not produced a result yet, so its columns are unknown, and that the mapping can still be saved but nothing has checked it. That is the `unvalidated` state stated in the form rather than only after the write.

- [ ] **Step 5: Write the form**

Create `app/src/components/published-feeds/feed-form.tsx`. Plain `useState` per field and `useId()` per control, matching `app/src/app/destinations/new/page.tsx`; there is no form library in this repo and no `<form>` element. Props:

```ts
interface FeedFormProps {
  /** Prefilled for an edit, absent for a create. */
  initial?: PublishedFeed
  /** Locked on edit: the slug is half the primary key and cannot be renamed. */
  slugLocked?: boolean
  submitLabel: string
  isPending: boolean
  error: string | null
  fieldErrors: Record<string, string>
  onSubmit: (input: PublishedFeedInput) => void
  onCancel: () => void
}
```

Sections in order: SOURCE (the query picker), ADDRESS (slug input, visibility radio group), SHAPE (the three constants as read-only text, not controls), MAPPING (the editor plus the static GTFS ref input), ON FAILURE (a radio group for `block` versus `last_good`, with the age-cap number input appearing only for `last_good`, since the schema refuses a cap on `block` and requires one on `last_good`).

Submit builds `PublishedFeedInput` with `standard: 'gtfs-rt'`, `version: '2.0'`, `entity: 'vehicle_positions'`, `columnMap: toColumnMap(selection)`, and `lastGoodMaxAgeSeconds` null unless the mode is `last_good`. Before calling `onSubmit`, refuse locally when `missingRequired(selection)` is non-empty and put the message on those rows.

Keep this file under 300 lines. If it grows past that, move the on-failure section into its own component rather than extracting a hook; a hook returning setters would break `react-hooks/preserve-manual-memoization` at every callback that closes over them.

- [ ] **Step 6: Write the create page and its test**

Create `app/src/app/connect/feeds/new/page.tsx`: reads the picked query's latest result columns (see below), renders `FeedForm`, calls `useCreatePublishedFeed().mutateAsync`, and on success routes to `/connect/feeds/${slug}`. On refusal it parses the `AppError`, and maps it to `fieldErrors`:

- `VEODYN_PUBLISHED_FEED_SLUG_TAKEN` to the slug field.
- `VEODYN_PUBLISHED_FEED_QUERY_UNREADABLE` to the query picker.
- `VEODYN_PUBLISHED_FEED_BINDING_INVALID`: split the message after the leading `the column map cannot produce this feed: ` on `'; '`, and place each problem on the mapping row whose field name it quotes. A problem naming no known field falls back to the form-level error.

For the query's result columns, add `useQueryResultColumns(queryId: number | undefined)` to `app/src/hooks/use-published-feeds.ts`, reading through the existing `/api/redash/[...path]` passthrough: the query for `latest_query_data_id`, then that result for `data.columns[].name`. Do not add a backend endpoint for this.

It returns `{ resultId: number | null; columns: string[] }`, not just the columns. Task 9's guard needs the result id to compare against the current artifact's `queryResultId`, and reading it twice through two hooks would be two reads of the same pair. In mock mode resolve it from the mock store's queries so the form works with no backend. Give it its own test.

Create `app/src/app/connect/feeds/new/page.test.tsx` covering: a required field left unmapped blocks the post and names the field; a 409 puts its message on the slug field; a `BINDING_INVALID` 422 puts each problem on its own mapping row; a successful create routes to the detail page.

- [ ] **Step 7: Run the tests, the gate, and commit**

Run: `cd app && pnpm vitest run src/app/connect/feeds src/components/published-feeds`
Run: `cd app && pnpm lint && pnpm exec tsc --noEmit`

```bash
git add app/src/lib/gtfs-fields.ts app/src/components/published-feeds app/src/app/connect/feeds/new
git commit -m "feat(app): declare a published feed from a closed-set mapping form"
```

---

### Task 9: The edit page, the going-dark confirm, and the stale-result guard

**Files:**
- Create: `app/src/app/connect/feeds/[slug]/edit/page.tsx`
- Create: `app/src/app/connect/feeds/[slug]/edit/loading.tsx`
- Create: `app/src/app/connect/feeds/[slug]/edit/page.test.tsx`
- Modify: `app/src/app/connect/feeds/[slug]/page.tsx` (the delete confirm and the publish guard)
- Modify: `app/src/app/connect/feeds/connect-feeds.restyle.test.ts`

**Interfaces:**
- Consumes: `FeedForm` from Task 8; `useUpdatePublishedFeed`, `useDeletePublishedFeed`, `usePublishNow`, `useAttempts` from Task 5.
- Produces: nothing further.

- [ ] **Step 1: Write the failing tests**

**First, fix the two Task 7 tests this task is about to break.** The publish control was always enabled in Task 7, and the fixture's newest attempt is `isCurrent` with `queryResultId: 501`. Once the guard lands, that is exactly the state where the button disappears, so `offers publishing only to an administrator` and `records an attempt when publish is pressed` both fail. Update them to seed a query result newer than 501 through whatever `useQueryResultColumns` (or its sibling) reports, so the guard passes and those two tests keep testing what they were written to test. Do not delete them and do not weaken them into asserting absence.

Create `app/src/app/connect/feeds/[slug]/edit/page.test.tsx` covering:

- Saving a feed that is currently serving opens a confirm whose text says the feed goes off the air until an attempt succeeds and that consumers get nothing meanwhile.
- Saving a feed that is already dark saves with no confirm.
- Confirming the save fires an attempt immediately, so the history gains a row without a second press.
- The slug field is present but not editable, and the page says a feed cannot be renamed.

And add to `app/src/app/connect/feeds/[slug]/page.test.tsx`:

- When the newest attempt is `isCurrent` and the query's latest result id equals that attempt's `queryResultId`, the publish control is absent and the page says the query has produced nothing new since the last publish.
- Deleting asks for confirmation whose text says consumers of the address start getting nothing.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && pnpm vitest run "src/app/connect/feeds/[slug]"`
Expected: FAIL.

- [ ] **Step 3: Write the edit page**

Create `app/src/app/connect/feeds/[slug]/edit/page.tsx`: same three-branch loading convention, `FeedForm` with `initial` and `slugLocked`, and a `ConfirmDialog` from `@/components/shared/confirm-dialog` gated on whether any attempt currently carries `isCurrent`. Its `title` is `Take this feed off the air?` and its `description` states the consequence in the spec's words. `destructive` is true. On confirm: `await update.mutateAsync(...)`, then `await publish.mutateAsync(slug)`, then route to the detail page. If the update rejects, do not publish and leave every value on screen, exactly as `destinations/new` does.

- [ ] **Step 4: Add the stale-result guard and the delete confirm to the detail page**

In `app/src/app/connect/feeds/[slug]/page.tsx`, replace the always-enabled publish control from Task 7. Compare the query's latest result id (same read the create page uses) against the current artifact's `queryResultId`. When they match, render the explanatory line instead of the button. The comment should say why: an attempt whose result is not newer than the published one is recorded as `failed` by the engine, so firing it would manufacture a failure that reads as a bug.

Add a `ConfirmDialog` for delete, saying that consumers of the address start getting nothing and that a deleted slug is indistinguishable from one that never existed.

- [ ] **Step 5: Run the whole app suite and the gate**

Run: `cd app && pnpm test`
Run: `cd app && pnpm lint && pnpm exec tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Prove the new guards can fail**

For each of these, revert the implementation, confirm the test fails, then restore it: the going-dark confirm, the stale-result guard, the blocked-versus-failed split, and the findings grouping. A test that cannot fail is the costliest kind here.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/connect/feeds
git commit -m "feat(app): warn before an edit takes a feed dark, then republish it"
```

---

## Notes for the executor

**What this plan does not build**, all deliberate:

- No serving URL is shown anywhere. Nothing in the tree names the path a published feed is served at, `routers.public` is enterprise and absent, and inventing one would put a copyable address on screen that resolves to nothing. The detail page shows the slug. This is open question 1 in the spec.
- No serving state on the list. The list endpoint runs no check and reads no attempts, and a per-row attempt fetch would be a read per row to render a word.
- No attribution, no gate 1a/1b verdicts, no Feed Health surfacing. Those are P2 in the mechanism design.

**Where this plan gives prose instead of code, that is deliberate.** Tasks 1 to 5 carry the code verbatim, because their shapes are contracts other tasks depend on and a guess would propagate. The page bodies in Tasks 6 to 9 are specified as a named template file plus the behaviour, copy, and branch order they must have, because transcribing JSX for five pages would mean inventing markup against primitives whose exact prop spellings are better read from the file than from this document. Read the named template first, then write the page. Every test in those tasks IS given verbatim, so the target is not ambiguous.

**Two fixtures need imports that are not spelled out.** `app/src/lib/mock-data.ts` gains `mockPublishedFeeds` and `mockPublishAttempts`, so it needs `import type { PublishAttempt, PublishedFeed } from '@/types/published-feed'` added in the same edit as the fixtures themselves, or lint fails on the intermediate state.

**If you find the spec wrong, say so rather than coding around it.** Two of its claims were already corrected during planning (a blocked attempt's `reason` is a count, not empty; the field vocabulary cannot come from the generated types). A third is likely.
