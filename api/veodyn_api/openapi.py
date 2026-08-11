"""Print the OpenAPI schema to stdout.

The frontend generates its `components['schemas']` types from this, and a
vitest type assertion compares them against the hand-written contract in
`app/src/types/kpi.ts`. Dumping the schema from the app object rather
than curling a running server means the type-drift gate needs no database, no
Redash and no listening port, so CI can run it in the frontend job.

Usage: `uv run python -m veodyn_api.openapi > openapi.json`
"""

import json
import sys

from veodyn_api.main import create_app


def main() -> None:
    json.dump(create_app().openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
