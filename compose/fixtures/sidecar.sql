-- Community sidecar content for the local stack, applied to the `veodyn` database
-- by compose/seed-catalog.py after `alembic upgrade head` has built the schema.
--
-- Plain SQL rather than the ORM, because none of these tables has an encrypted
-- column and the seed container runs the node image, which does not have
-- veodyn_api installed. The enterprise half of this fixture is not here: it names
-- tables defined in a private pack, so it lives in scripts/dev-stack/, which is
-- deploy-only.
--
-- Tokens, substituted by the seed script:
--   __QID_<key>__        the Redash query id
--   __TABLENAME_<key>__  the bare ClickHouse table name, no database prefix,
--                        which is what a capture-origin dataset reports as its
--                        feed_id (services/catalog.py, `source.table`)
--   __ADMIN_USER_ID__    the seeded admin's Redash user id
--
-- ON CONFLICT DO NOTHING throughout, so a re-run against a stack somebody has
-- already used adds what is missing and overwrites none of their edits.

-- ── Feed expectations ───────────────────────────────────────────────────────
-- How often each captured dataset is expected to refresh. This is what lets the
-- feed-health board judge a feed at all: with no expectation a feed has no
-- verdict, so an empty table renders the board as a list of shrugs.
--
-- alert_id and alert_query_id stay null. They are the forward link to a derived
-- late-alert, and arming one means creating a real Redash alert; a row pointing
-- at an alert that does not exist would be worse than an unarmed expectation.
INSERT INTO feed_expectation
  (org_slug, feed_id, expected_interval_seconds, set_by_user_id, alert_id, alert_query_id)
VALUES
  ('default', '__TABLENAME_bikeshare_availability__', 900, __ADMIN_USER_ID__, NULL, NULL),
  ('default', '__TABLENAME_bikeshare_stations__', 86400, __ADMIN_USER_ID__, NULL, NULL),
  ('default', '__TABLENAME_transit_vehicles__', 300, __ADMIN_USER_ID__, NULL, NULL),
  ('default', '__TABLENAME_weather_history__', 3600, __ADMIN_USER_ID__, NULL, NULL)
ON CONFLICT (org_slug, feed_id) DO NOTHING;

-- ── A published feed ────────────────────────────────────────────────────────
-- One GTFS-Realtime VehiclePosition feed over the transit capture, private.
--
-- Private rather than public, deliberately. A public feed is served unauthenticated
-- at a stable slug, and a fixture that ships one turns every developer's laptop
-- into an open endpoint the moment a port is forwarded. Flip it in the UI when you
-- are testing the public path.
--
-- on_error 'block' matches the column's server default: a publish whose source
-- query fails serves nothing rather than stale bytes. last_good_max_age_seconds
-- must then be NULL, and ck_published_feed_cap_matches_mode enforces it: a cap on
-- 'block' is a promise to serve stale bytes under a name that denies it.
INSERT INTO published_feed
  (org_slug, slug, revision, query_id, standard, version, entity, static_gtfs_ref,
   source_column, column_map, on_error, last_good_max_age_seconds, visibility,
   created_by_user_id)
VALUES
  ('default', 'transit-vehicle-positions', 1, __QID_transit_vehicles__,
   'gtfs-rt', '2.0', 'vehicle_position', 'https://example.org/static/gtfs.zip',
   NULL,
   '{"vehicle_id": "vehicle_id", "route_id": "route_id", "latitude": "latitude", "longitude": "longitude", "bearing": "bearing"}'::jsonb,
   'block', NULL, 'private', __ADMIN_USER_ID__)
ON CONFLICT (org_slug, slug) DO NOTHING;

-- ── Tags ────────────────────────────────────────────────────────────────────
-- Datasets carry their domain here, not in Redash. A query's own tags put the
-- QUERY in a hub; these put the captured DATASET in one, and the catalog reads
-- the two separately.
INSERT INTO tag_assignment (org_slug, object_type, object_id, tag) VALUES
  ('default', 'dataset', '__TABLENAME_bikeshare_stations__', 'domain:micromobility'),
  ('default', 'dataset', '__TABLENAME_bikeshare_availability__', 'domain:micromobility'),
  ('default', 'dataset', '__TABLENAME_transit_vehicles__', 'domain:transit'),
  ('default', 'dataset', '__TABLENAME_weather_history__', 'domain:weather'),
  ('default', 'dataset', '__TABLENAME_bikeshare_availability__', 'reference'),
  ('default', 'dataset', '__TABLENAME_transit_vehicles__', 'reference')
ON CONFLICT (org_slug, object_type, object_id, tag) DO NOTHING;

-- ── No favorites here ───────────────────────────────────────────────────────
-- Deliberately none, and this note is the finding rather than a placeholder.
--
-- The `favorite` table only surfaces rows whose object_type is a REGISTERED
-- favoritable kind (routers/favorites.py builds its response from
-- registry.favoritable_kinds()). Datasets are registered `favoritable=False`
-- (routers/catalog.py), because a star needs a table to gate the insert on and
-- the Favorites page has no dataset section. Queries are Redash's own favorites
-- and live in Redash's database, not this one.
--
-- So on a community stack there is no favoritable kind to seed: a row for either
-- would be written, accepted, and invisible. The enterprise fixture seeds `kpi`
-- and `report` favorites, which are registered kinds.
