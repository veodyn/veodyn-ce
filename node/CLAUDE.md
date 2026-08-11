# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**node**, the query backend: a headless query, dashboard and scheduling API. Flask backend with SQLAlchemy ORM. Background jobs via Redis Queue (RQ). Data sources come from a pluggable query runner system. The default list has 40 entries, 13 of them the transportation connectors. The React client and `viz-lib` visualization library that used to live in this tree were deleted; the product UI is the separate Next.js app in `app/`.

The inner Python package is named `redash` (`import redash`, `redash.settings`), and the paths below are literal: the name is a deployed contract across module paths, settings and migrations, so it is not renamed. `NOTICE` at the repository root carries the licensing.

## Development Commands

### Environment Setup
```bash
make compose_build        # Build Docker images
make up                   # Start dev environment (Redis, PostgreSQL, servers)
make create_database      # Initialize the node database
```

### Testing
```bash
# Backend
make backend-unit-tests   # Sets up test DB and runs pytest
docker compose run server tests  # Run pytest directly
docker compose run server tests/test_models.py::TestClassName::test_method  # Single test
```

### Linting & Formatting
```bash
ruff check .              # Python linting
black --check .           # Python formatting (119 char line length)

# Combined
make lint                 # ruff + black
```

### CLI (inside Docker or with app context)
```bash
python manage.py shell              # Interactive shell
python manage.py database create-db # Create database
python manage.py users create ...   # User management
python manage.py ds ...             # Data source management
```

## Architecture

### Backend (`redash/`)

**Flask app** initialized in `redash/__init__.py` (sets up Redis, mail, DB, migrations, stats, rate limiting) with factory in `redash/app.py`.

- **`models/`**: SQLAlchemy ORM. Core models (DataSource, Query, QueryResult, Dashboard, Widget, Visualization, User, Group, Alert, Organization) are in `models/__init__.py`. Custom column types (EncryptedConfiguration, MutableDict) in `models/types.py`. Query parameter parsing in `models/parameterized_query.py`.

- **`handlers/`**: Flask-RESTful API endpoints (26 handler modules). `handlers/api.py` wires routes. Largest: `handlers/queries.py`.

- **`query_runner/`**: Pluggable data source drivers (54 files, 40 registered in the default list). Base classes in `query_runner/__init__.py`: `BaseQueryRunner`, `BaseSQLQueryRunner`, `BaseHTTPQueryRunner`. Each driver implements `run_query()`, `get_schema()`, and declares `configuration_schema()`. Drivers are auto-discovered via `redash/settings/__init__.py` (`QUERY_RUNNERS` list). Not every file in the directory is registered: the curation that picked the shipping set left the rest in place.

- **`destinations/`**: Alert notification channels (3 files, 2 registered by default). Same plugin pattern as query runners: `BaseDestination` base class, auto-discovered via settings.

- **`tasks/`**: RQ background jobs: query execution, scheduled refreshes, alert evaluation, email sending.

- **`settings/`**: All configuration via environment variables (`settings/__init__.py`, ~23KB). Dynamic runtime settings in `dynamic_settings.py`, per-org settings in `organization.py`.

- **`cli/`**: Click-based management commands (database, users, groups, data sources, queries, orgs, RQ).

### Testing Infrastructure

- **Backend:** pytest with factory-based fixtures in `tests/factories.py` (user_factory, org_factory, data_source_factory, query_factory, etc.). `BaseTestCase` in `tests/__init__.py`. PostgreSQL runs with fsync=off.

- **Parallel runs partition the datastores.** `tests/__init__.py` gives each pytest-xdist worker its own Postgres database and its own pair of Redis databases, because the suite empties both between every test: `gw0` takes Redis 2 and 3, `gw1` takes 4 and 5, and so on. Redis ships 16 databases, so this holds to `-n 7` and raises above it. A serial run keeps 5 and 6. `BaseTestCase` recreates the schema per test, so do not drop the `tests` database chasing a failure.

## Code Style

- **Python:** Black (119 char lines), Ruff for linting/import sorting. Migrations excluded from formatting.
- **Never run `ruff format` here.** `make lint` is `ruff check` plus `black --check`, so Black owns formatting in this tree. `ruff format` would reformat against Black and turn a one-line change into a whole-tree diff. Run `ruff check` and leave formatting to Black.

## Key Patterns

- **Plugin system:** Query runners and destinations use a registry pattern: new data sources are added by creating a module in `query_runner/`, implementing the base class interface, and adding the dotted path to `QUERY_RUNNERS` in settings.
- **Permissions:** `redash/permissions.py` handles access control. Models use `BelongsToOrgMixin` for multi-tenancy.
- **Configuration encryption:** Data source credentials stored using `EncryptedConfiguration` column type.
- **Parameterized queries:** User-facing query parameters parsed in `models/parameterized_query.py`, rendered via Mustache templating.
