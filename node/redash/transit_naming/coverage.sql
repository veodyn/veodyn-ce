SELECT carrier_code, 'routes_by_source' AS metric, public_name_source AS dimension, COUNT(*) AS value, normalization_revision, gtfs_digest
FROM {routes} GROUP BY carrier_code, public_name_source, normalization_revision, gtfs_digest
UNION ALL
SELECT carrier_code, 'route_passthrough', route_code, route_code, normalization_revision, gtfs_digest
FROM {routes} WHERE public_name_source = 'passthrough'
UNION ALL
SELECT carrier_code, 'stops_by_kind', stop_kind, COUNT(*), normalization_revision, gtfs_digest
FROM {stops} GROUP BY carrier_code, stop_kind, normalization_revision, gtfs_digest
UNION ALL
SELECT carrier_code, 'stops_by_source', public_name_source, COUNT(*), normalization_revision, gtfs_digest
FROM {stops} GROUP BY carrier_code, public_name_source, normalization_revision, gtfs_digest
UNION ALL
SELECT carrier_code, 'stops_retired', 'true', COUNT(*), normalization_revision, gtfs_digest
FROM {stops} WHERE retired IN (1, 'true', 'True') GROUP BY carrier_code, normalization_revision, gtfs_digest
UNION ALL
SELECT carrier_code, 'unparsed_stop', stop_id, public_name, normalization_revision, gtfs_digest
FROM {stops} WHERE stop_kind = 'unparsed'
UNION ALL
SELECT carrier_code, 'intersection_with_ampersand', stop_id, public_name, normalization_revision, gtfs_digest
FROM {stops} WHERE stop_kind = 'intersection' AND public_name LIKE '%&%'
UNION ALL
SELECT carrier_code, 'route_stops_by_match', stop_match, COUNT(*), normalization_revision, gtfs_digest
FROM {route_stops} GROUP BY carrier_code, stop_match, normalization_revision, gtfs_digest
UNION ALL
SELECT carrier_code, 'route_stops_by_sequence_source', sequence_source, COUNT(*), normalization_revision, gtfs_digest
FROM {route_stops} GROUP BY carrier_code, sequence_source, normalization_revision, gtfs_digest
UNION ALL
SELECT r.carrier_code, 'route_without_pattern', r.route_code, r.route_code, r.normalization_revision, r.gtfs_digest
FROM {routes} r LEFT JOIN {route_stops} p ON p.carrier_code = r.carrier_code AND p.route_code = r.route_code
WHERE p.route_code IS NULL
UNION ALL
SELECT carrier, 'departures_route_source', public_route_name_source, COUNT(*), normalization_revision, gtfs_digest
FROM {departures} GROUP BY carrier, public_route_name_source, normalization_revision, gtfs_digest
UNION ALL
SELECT carrier, 'departures_stop_source', public_stop_name_source, COUNT(*), normalization_revision, gtfs_digest
FROM {departures} GROUP BY carrier, public_stop_name_source, normalization_revision, gtfs_digest
UNION ALL
SELECT d.carrier_code, 'digest_disagreement', 'routes', d.gtfs_digest, d.normalization_revision, d.gtfs_digest
FROM (SELECT DISTINCT carrier_code, normalization_revision, gtfs_digest FROM {routes}) d
WHERE d.gtfs_digest <> '' AND d.gtfs_digest NOT IN (SELECT p.gtfs_digest FROM {route_stops} p WHERE p.carrier_code = d.carrier_code AND p.gtfs_digest <> '')
UNION ALL
SELECT d.carrier_code, 'digest_disagreement', 'route_stops', d.gtfs_digest, d.normalization_revision, d.gtfs_digest
FROM (SELECT DISTINCT carrier_code, normalization_revision, gtfs_digest FROM {route_stops}) d
WHERE d.gtfs_digest <> '' AND d.gtfs_digest NOT IN (SELECT r.gtfs_digest FROM {routes} r WHERE r.carrier_code = d.carrier_code AND r.gtfs_digest <> '')
UNION ALL
SELECT d.carrier_code, 'digest_disagreement', 'stops', d.gtfs_digest, d.normalization_revision, d.gtfs_digest
FROM (SELECT DISTINCT carrier_code, normalization_revision, gtfs_digest FROM {stops}) d
WHERE d.gtfs_digest <> '' AND d.gtfs_digest NOT IN (SELECT r.gtfs_digest FROM {routes} r WHERE r.carrier_code = d.carrier_code AND r.gtfs_digest <> '')
UNION ALL
SELECT d.carrier, 'digest_disagreement', 'departures', d.gtfs_digest, d.normalization_revision, d.gtfs_digest
FROM (SELECT DISTINCT carrier, normalization_revision, gtfs_digest FROM {departures}) d
WHERE d.gtfs_digest <> '' AND d.gtfs_digest NOT IN (SELECT r.gtfs_digest FROM {routes} r WHERE r.carrier_code = d.carrier AND r.gtfs_digest <> '')
UNION ALL
SELECT carrier_code, 'gtfs', 'none', COUNT(*), normalization_revision, ''
FROM {routes} GROUP BY carrier_code, normalization_revision HAVING MAX(gtfs_digest) = ''
