# Built with uv rather than pip or Poetry: it resolves from the committed
# uv.lock, so the image gets the same versions CI tested.
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, in their own layer, so a source change does not
# reinstall the world.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY veodyn_api ./veodyn_api
COPY migrations ./migrations
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

EXPOSE 8000

# A community deployment runs only this. There is no worker in the community
# edition: the one recurring job evaluates KPIs, which are enterprise, so the
# worker ships in veodyn-enterprise and an enterprise image overrides this CMD
# with `uv run --no-dev python -m veodyn_enterprise.worker`. It is still one
# image serving both, so the two cannot drift in dependency versions.
#
# --no-dev matches the sync above. Without it `uv run` re-syncs WITH the dev
# group at container start, so every boot pulled mypy, pytest, ruff and respx
# over the network and spent about twenty seconds compiling bytecode before the
# process began. A restart loop turns that into a lot of wasted time, and dev
# tooling has no business in a running deployment.
CMD ["uv", "run", "--no-dev", "uvicorn", "veodyn_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
