"""
Unit tests for the pre-flight validation helpers shared by connector_base.

Regression coverage: `require_configured` / `require_params` used to treat
any falsy value as missing, which rejected a valid numeric 0 (a real
latitude/longitude, such as the equator or the prime meridian) as if it were
absent. AirNow and OpenWeatherMap both take latitude/longitude as params, so
this silently broke queries for real-world coordinates until the previous
fix reached the vendor with an error instead of the query actually running.
"""

from redash.query_runner.connector_validation import require_configured, require_params


class TestRequireConfigured:
    def test_none_is_missing(self):
        assert require_configured("conn", field=None) == "conn: 'field' is not configured"

    def test_empty_string_is_missing(self):
        assert require_configured("conn", field="") == "conn: 'field' is not configured"

    def test_whitespace_only_string_is_missing(self):
        assert require_configured("conn", field="   ") == "conn: 'field' is not configured"

    def test_integer_zero_is_present(self):
        assert require_configured("conn", field=0) is None

    def test_float_zero_is_present(self):
        assert require_configured("conn", field=0.0) is None

    def test_string_zero_is_present(self):
        assert require_configured("conn", field="0") is None

    def test_non_empty_string_is_present(self):
        assert require_configured("conn", field="value") is None

    def test_reports_the_first_missing_field_by_name(self):
        error = require_configured("conn", present="ok", missing="", also_missing=None)
        assert error == "conn: 'missing' is not configured"


class TestRequireParams:
    def test_missing_param_is_missing(self):
        assert require_params("conn", {}, "latitude") == "conn: 'latitude' param is required"

    def test_none_param_is_missing(self):
        assert require_params("conn", {"latitude": None}, "latitude") == "conn: 'latitude' param is required"

    def test_whitespace_only_param_is_missing(self):
        assert require_params("conn", {"latitude": "  "}, "latitude") == "conn: 'latitude' param is required"

    def test_latitude_zero_int_is_present(self):
        assert require_params("conn", {"latitude": 0}, "latitude") is None

    def test_longitude_zero_float_is_present(self):
        assert require_params("conn", {"longitude": 0.0}, "longitude") is None

    def test_latitude_string_zero_is_present(self):
        assert require_params("conn", {"latitude": "0"}, "latitude") is None

    def test_both_coordinates_at_null_island_are_present(self):
        assert require_params("conn", {"latitude": 0, "longitude": 0.0}, "latitude", "longitude") is None
