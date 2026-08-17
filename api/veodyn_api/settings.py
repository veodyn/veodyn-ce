from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Every runtime knob, read once from the environment.

    Kept flat and boring on purpose: whatever is running, an API process or a
    pack's worker, shares this object, so anything conditional here becomes a
    divergence between them.

    SOME KNOBS BELOW ARE READ ONLY BY THE ENTERPRISE PACK, and they belong here
    anyway. A pack imports `veodyn_api.settings` rather than declaring settings
    of its own, so that one process has one settings object with one env prefix
    and one place to look. `grep` inside this package will therefore find no
    reader for several of these; that is not evidence they are dead. The
    enterprise ones are marked.
    """

    model_config = SettingsConfigDict(env_file=".env", env_prefix="VEODYN_", extra="ignore")

    redash_url: str = "http://localhost:5001"
    # A dedicated Redash service account's user API key, for the work that has
    # no caller to borrow credentials from: arming and resyncing feed alerts,
    # assembling AI grounding, and, on an enterprise build, running KPI source
    # queries from the worker. It needs execute access to the data sources
    # behind those queries and nothing more; it must not be an admin.
    redash_service_api_key: str = ""
    database_url: str = "postgresql+psycopg://postgres@localhost:15432/veodyn"
    redis_url: str = "redis://localhost:6379/5"
    session_cache_ttl_seconds: int = 30
    # Enterprise. A manual recompute is synchronous because the UI needs the new
    # reading in the response, so it needs a hard ceiling.
    recompute_timeout_seconds: int = 30
    # Enterprise, both: the scheduled evaluation job's poll ceiling and the cap
    # on its failure backoff.
    job_poll_timeout_seconds: int = 120
    max_failure_backoff_minutes: int = 60
    # The historical warehouse Redash captures scheduled query results into
    # (node/redash/historical/). The catalog reads it; nothing here writes to
    # it. Empty url = no warehouse configured, and /catalog answers 503.
    clickhouse_url: str = ""
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    clickhouse_database: str = "historical"
    clickhouse_timeout_seconds: float = 10.0
    # A capture table is stale once nothing new has landed for this long. The
    # shortest capture schedule seen in a real deployment is 10 minutes, so an
    # hour is several missed runs rather than one late one.
    catalog_stale_after_minutes: int = 60
    # Our own validator: `validator/` in this repo, an HTTP wrapper around the
    # gtfs-rt-validator package (veodyn/gtfs-rt-validator, pinned to 0.2.0),
    # deployed by the veodyn-validator chart. It is a service rather than an
    # import because the prepared static archive costs ~48s and ~1.9 GB per
    # feed, which every API replica would otherwise pay on a cold call; see
    # services/feed_validator.py. NOT MobilityData's Java tool, which this
    # comment named until 2026-08-17 and which that package exists to replace.
    # Empty means no validator is configured, and a publish attempt then fails
    # closed rather than publishing unvalidated bytes.
    feed_validator_url: str = ""

    # Dotted module paths, comma separated, imported at startup by both the API
    # and the worker. Importing a module is what registers whatever it
    # contributes (routers, jobs, object types, hub providers), mirroring
    # REDASH_ADDITIONAL_QUERY_RUNNERS. Empty is the community edition: no pack,
    # every registry holding only what ships in this package. A module named
    # here and not importable raises rather than being skipped, because a
    # feature that is configured and silently absent is the worst of the three
    # outcomes.
    extra_modules: str = ""

    # --- Telemetry (PostHog) ---
    # Read as VEODYN_POSTHOG_KEY / VEODYN_POSTHOG_HOST because of the env_prefix
    # above. Either one empty disables capture entirely, which is how the prod
    # release stays dark while stage reports. The key is a client-side ingestion
    # token rather than a secret, so it sits in the Helm values in the clear.
    posthog_key: str = ""
    posthog_host: str = ""
    disable_telemetry: bool = False

    # Enterprise. Four-eyes on report approval: the account that submitted a
    # report for review may not be the one that approves it. On by default,
    # because an approval workflow whose default is "anyone including you" is
    # not a workflow. A single-author instance can turn it off rather than being
    # unable to approve anything.
    reports_require_separate_approver: bool = True
    # Enterprise. Snapshotting runs every query in a document synchronously, because the
    # editor needs the frozen document back in the response. One budget for the
    # whole document rather than one per query: a report with ten blocks would
    # otherwise be allowed ten times the ceiling, and the author would be
    # staring at a spinner with no idea it was still legitimate.
    report_snapshot_timeout_seconds: int = 120

    # --- The AI provider (/ai/*) ---
    # The shared secret veodyn-de's AI relay presents as `Authorization: Bearer`.
    # That relay deliberately strips the browser's cookie before calling out
    # (the endpoint may be a third party), so this is the ONLY credential on an
    # /ai request. Empty means the routes answer 503: no key configured is "AI
    # is not set up here", never "let anyone in".
    ai_relay_key: str = ""
    # The model credential. Empty disables the routes the same way.
    ai_api_key: str = ""
    ai_base_url: str = "https://api.anthropic.com"
    ai_model: str = "claude-sonnet-5"
    # Generous next to the rest of this service: a report draft is several
    # sections of prose, and the frontend shows a pending state throughout.
    # Unset means the parameter is not sent at all. Current Claude models refuse
    # a request that carries it ("`temperature` is deprecated for this model",
    # HTTP 400); set it only when pointing at an older model that wants one.
    ai_temperature: float | None = None
    ai_timeout_seconds: float = 90.0
    ai_max_output_tokens: int = 8192
    # Grounding budget. Every prompt names real queries, and the list is what
    # keeps the model from inventing an id; it is capped so a large instance
    # does not push the prompt past the context that matters.
    ai_max_grounded_queries: int = 60
    # The digest is fetched on every Home render and changes on the cadence of
    # KPI evaluation and warehouse capture, which is minutes at best. Without a
    # cache every visit to the home page would spend a model call to restate
    # the same six sentences.
    ai_digest_cache_seconds: int = 600


@lru_cache
def get_settings() -> Settings:
    return Settings()
