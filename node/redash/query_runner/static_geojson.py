"""
Static GeoJSON query runner.

Serves static geographic datasets (rail lines, bus routes, service areas, or
any other named feature layers) from a directory of GeoJSON files plus a
manifest. No external calls: the data is read from disk, from the directory
named by the data source's required `data_path` configuration.

Query format (JSON):

    {
        "layers": ["<layer_id>", "<layer_id_2>"],
        "filter": {"line": ["A_Line", "B_Line"]},
        "format": "rows"          # rows (default) | featurecollection
    }

Also supports a discovery resource:

    {"resource": "list"}          # enumerate available datasets

Output formats:
- rows: one row per feature, columns layer, feature_id, name, line, mode,
  color, geometry_type, geometry (GeoJSON geometry as a string), properties
  (remaining props as JSON), bbox. Unioning several layers concatenates their
  features; the `layer` column distinguishes sources. This is what the MAP_GEO
  visualization consumes.
- featurecollection: a single row / single `geojson` column holding the merged
  FeatureCollection string, ready to drop into L.geoJSON().

Data directory layout: a `manifest.json` naming the layers, plus one GeoJSON
FeatureCollection file per layer, beside it. See
`redash/query_runner/geo_data/README.md` for the manifest schema.
"""

import json
import logging
import os

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    serialize_result,
    to_redash_table,
)

logger = logging.getLogger(__name__)

# Thin, consistent column set so a union across differently-shaped layers stays
# clean; anything not lifted here is kept in the `properties` JSON column.
LIFTED_PROPS = ("id", "line", "name", "mode", "color")


def _bbox(geometry):
    """Compute [minLng, minLat, maxLng, maxLat] for a GeoJSON geometry."""
    coords = geometry.get("coordinates")
    xs, ys = [], []

    def walk(node):
        if not node:
            return
        if isinstance(node[0], (int, float)):
            xs.append(node[0])
            ys.append(node[1])
        else:
            for child in node:
                walk(child)

    walk(coords)
    if not xs:
        return None
    return [min(xs), min(ys), max(xs), max(ys)]


class StaticGeoJSON(BaseResourceRunner):
    default_resource = "features"
    noop_query = '{"resource": "list"}'

    def __init__(self, configuration):
        super().__init__(configuration)
        self.data_dir = self.configuration.get("data_path", "")
        self._manifest = None

    @property
    def manifest(self):
        if self._manifest is None:
            self._manifest = self._load_manifest()
        return self._manifest

    @classmethod
    def name(cls):
        return "Static GeoJSON"

    @classmethod
    def type(cls):
        return "static_geojson"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "data_path": {
                    "type": "string",
                    "title": "Layer Directory",
                    "description": "Directory holding manifest.json and the layer files it names.",
                },
            },
            required=["data_path"],
            include_redis=False,
        )

    def _load_manifest(self):
        """Load manifest.json: {layer_id: {"file": ..., "title": ..., ...}, ...}."""
        with open(os.path.join(self.data_dir, "manifest.json")) as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict) or isinstance(raw.get("layers"), list):
            raise Exception(
                "manifest.json must map each layer id directly to its metadata, "
                'e.g. {"rail_lines": {"file": "rail_lines.geojson", ...}}, not a '
                '{"layers": [...]} list.'
            )
        return raw

    def test_connection(self):
        # Data is local, not fetched: just confirm the manifest and every
        # referenced file are present and parseable.
        for key, meta in self.manifest.items():
            path = os.path.join(self.data_dir, meta["file"])
            with open(path) as fh:
                json.load(fh)

    def _load_layer(self, key):
        meta = self.manifest[key]
        with open(os.path.join(self.data_dir, meta["file"])) as fh:
            return json.load(fh)

    def _matches(self, props, filters):
        for field, wanted in filters.items():
            if not isinstance(wanted, list):
                wanted = [wanted]
            if props.get(field) not in wanted:
                return False
        return True

    def _collect_features(self, layers, filters):
        """Return [(layer_key, feature), ...] across the requested layers."""
        collected = []
        for key in layers:
            if key not in self.manifest:
                available = ", ".join(sorted(self.manifest))
                raise Exception(f"Unknown layer {key!r}. Available layers: {available}")
            for feature in self._load_layer(key).get("features", []):
                if filters and not self._matches(feature.get("properties", {}), filters):
                    continue
                collected.append((key, feature))
        return collected

    def _feature_to_row(self, layer_key, feature):
        props = dict(feature.get("properties", {}))
        geometry = feature.get("geometry") or {}
        extra = {k: v for k, v in props.items() if k not in LIFTED_PROPS}
        return {
            "layer": layer_key,
            "feature_id": props.get("id"),
            "name": props.get("name"),
            "line": props.get("line"),
            "mode": props.get("mode"),
            "color": props.get("color"),
            "geometry_type": geometry.get("type"),
            "geometry": json.dumps(geometry),
            "properties": json.dumps(extra) if extra else "",
            "bbox": json.dumps(_bbox(geometry)) if geometry else "",
        }

    def run_query(self, query, user):
        from redash.query_runner.connector_validation import parse_object_query

        # _params is unused here (this runner reads layers/filter/format off
        # the query root, not off params), but it is still unpacked so the
        # shape check on params runs for this runner too.
        config, _params, error = parse_object_query(query)
        if error:
            return None, error

        resource = config.get("resource")

        if resource == "list":
            rows = [
                {
                    "layer": key,
                    "title": meta.get("title"),
                    "geometry": meta.get("geometry"),
                    "group": meta.get("group"),
                    "feature_count": len(self._load_layer(key).get("features", [])),
                    "properties": json.dumps(meta.get("properties", [])),
                }
                for key, meta in self.manifest.items()
            ]
            columns, rows = to_redash_table(rows)
            return serialize_result(columns, rows), None

        layers = config.get("layers")
        if not layers:
            single = config.get("layer")
            layers = [single] if single else list(self.manifest)
        if isinstance(layers, str):
            layers = [layers]

        filters = config.get("filter") or {}
        fmt = (config.get("format") or "rows").lower()

        try:
            features = self._collect_features(layers, filters)
        except Exception as e:
            return None, str(e)

        if fmt == "featurecollection":
            fc = {
                "type": "FeatureCollection",
                "features": [
                    {**feature, "properties": {**feature.get("properties", {}), "layer": key}}
                    for key, feature in features
                ],
            }
            columns = [{"name": "geojson", "friendly_name": "geojson", "type": "string"}]
            rows = [{"geojson": json.dumps(fc)}]
            return serialize_result(columns, rows), None

        rows = [self._feature_to_row(key, feature) for key, feature in features]
        columns, rows = to_redash_table(rows)
        return serialize_result(columns, rows), None

    def get_schema(self, get_stats=False):
        schema = []
        for i, (key, meta) in enumerate(self.manifest.items(), start=1):
            schema.append(
                {
                    "name": f"{i}. {key} ({meta.get('title')})",
                    "columns": [
                        f"geometry: {meta.get('geometry')}",
                        "properties: " + ", ".join(meta.get("properties", [])),
                    ],
                }
            )
        schema.append(
            {
                "name": "__ Query Format __",
                "columns": [
                    "layers: array of dataset keys to return (union)",
                    'filter: {property: value | [values]}, e.g. {"line": ["A_Line"]}',
                    "format: rows (default) | featurecollection",
                ],
            }
        )
        layer_ids = list(self.manifest)
        first = layer_ids[0] if layer_ids else "<layer_id>"
        examples = [
            "─────────────────────────────────────",
            "List available datasets",
            "─────────────────────────────────────",
            '{"resource": "list"}',
            "",
            "All features of one layer, as rows (for MAP_GEO)",
            f'{{"layers": ["{first}"]}}',
            "",
            "Two layers unioned into one map",
            '{"layers": ["<layer_id_1>", "<layer_id_2>"]}',
            "",
            "Filter by a property",
            f'{{"layers": ["{first}"], "filter": {{"<property>": ["<value>"]}}}}',
            "",
            "Merged FeatureCollection blob",
            f'{{"layers": ["{first}"], "format": "featurecollection"}}',
        ]
        schema.append({"name": "__ Query Examples __", "columns": examples})
        return schema


register(StaticGeoJSON)
