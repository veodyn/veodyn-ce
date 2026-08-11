#!/bin/sh
# Runs once, from the official Postgres image's initdb hook, on an empty data
# directory only. POSTGRES_DB creates the Redash database; this creates the
# second one, for veodyn-api's Alembic schema. Two databases rather than two
# schemas in one because the two services own their migrations independently
# and neither has any business seeing the other's tables.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE DATABASE ${VEODYN_API_DB:-veodyn};
SQL
