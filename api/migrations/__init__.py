"""The community Alembic chain.

A package rather than a bare script directory, so that `ownership.py` is
importable by name from `env.py` and by a test. Everything defined inside
`env.py` is unreachable except by running a migration context, so an allowlist
written there could not be read by the ratchet test that keeps it honest.

`alembic.ini` puts this directory's parent on `sys.path` (`prepend_sys_path`),
and the image copies the directory next to `alembic.ini` with the same working
directory, so `from migrations.ownership import ...` resolves the same way
under the CLI, in the container and under pytest. Nothing here ships in the
wheel; the wheel carries `veodyn_api` only.
"""
