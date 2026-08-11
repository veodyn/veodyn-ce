# Static GeoJSON layers

The `static_geojson` connector reads `manifest.json` and the layer files it
names from the directory a data source's `data_path` points at. `data_path`
is required and has no default: this directory is not read by the connector
at runtime, it exists only to document the manifest format below.

`manifest.json` maps each layer id directly to its metadata:

    {
      "rail_lines": {
        "file": "rail_lines.geojson",
        "title": "Rail lines",
        "geometry": "MultiLineString",
        "group": "rail",
        "properties": ["id", "line", "name", "mode", "color"]
      },
      "bus_lines": {
        "file": "bus_lines.geojson",
        "title": "Bus lines",
        "geometry": "MultiLineString",
        "group": "bus",
        "properties": ["id", "line", "name", "mode", "color"]
      }
    }

`file` is the only field the connector requires: the GeoJSON FeatureCollection
it names sits beside the manifest. `title`, `geometry`, `group` and
`properties` are shown in the schema browser and the `list` resource; leave
any of them out and that column is simply blank. Point a data source's
`data_path` at a directory of your own laid out this way; there is no bundled
default to fall back to.
