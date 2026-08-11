"""Alembic environment.

The database URL comes from veodyn_api.settings, not from alembic.ini, so the
API, the worker and the migrations all read the same env var.

This chain owns three tables and must mind only those. On a database that also
carries the enterprise chain, an unfiltered autogenerate proposes dropping
every enterprise table it reflects, so both `context.configure` calls take an
ownership filter on the reflection side and on the metadata side. Filtering one
side only is worse than filtering neither; `ownership.py` records the
measurement.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from migrations.ownership import include_name, include_object
from veodyn_api.models import Base
from veodyn_api.settings import get_settings

# Alembic's default, named here because the enterprise chain names its own
# (`alembic_version_ee`) and the pair only reads as a pair when both are
# written down.
VERSION_TABLE = "alembic_version"

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_name=include_name,
        include_object=include_object,
        version_table=VERSION_TABLE,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_name=include_name,
            include_object=include_object,
            version_table=VERSION_TABLE,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
