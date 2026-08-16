"""Environment configuration, read once at process start.

Every variable is prefixed ``VALIDATOR_`` and documented in ``.env.example``
beside this package, per the brief: this is a container and env vars are how a
deployment configures it. No secrets: the service authenticates nobody and
holds no credentials of its own.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VALIDATOR_", env_file=".env", extra="ignore")

    #: TCP port the service binds to. Read by the Dockerfile's CMD, not by
    #: uvicorn's own `--port`, so a deployment can override it with one env var
    #: rather than a command override.
    port: int = 8000

    #: How many prepared static feeds the cache holds at once. See
    #: `.env.example` for why 1 is the default rather than a larger number.
    cache_size: int = 1

    #: Seconds a prepared feed is trusted before the next request rebuilds it.
    cache_ttl_seconds: float = 3600.0

    #: Seconds to wait for the static GTFS archive to download.
    static_fetch_timeout_seconds: float = 60.0
