# Built with uv rather than pip or Poetry: it resolves from the committed
# uv.lock, so the image gets the same versions CI tested. Mirrors api/Dockerfile.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, in their own layer, so a source change does not
# reinstall the world. This layer is the expensive one: gtfs-rt-validator
# pulls in gtfs-validator, and both are pure Python, but the layer still
# should not be invalidated by an unrelated code change.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY validator_service ./validator_service
RUN uv sync --frozen --no-dev

EXPOSE 8000

# --no-dev matches the sync above, for the reason api/Dockerfile gives: without
# it, `uv run` re-syncs the dev group (pytest, respx, mypy, ruff) at every
# container start.
#
# The port is still 8000 here even though VALIDATOR_PORT defaults to 8000 too:
# uvicorn's --port does not read the env var itself, so a deployment that sets
# VALIDATOR_PORT to something else must override this CMD (or the EXPOSE/port
# pairing) to match. See README.md's "What the chart needs" section.
CMD ["uv", "run", "--no-dev", "uvicorn", "validator_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
