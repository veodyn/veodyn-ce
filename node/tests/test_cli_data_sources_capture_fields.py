"""
`ds new` must read the same augmented schema the admin UI and the save-path
validation use (redash.query_runner.get_configuration_schema_for_query_runner_type),
not the runner's raw configuration_schema(), or interactive creation never
prompts for the three historical-capture fields.

Non-interactive (--options) on purpose: jsonschema.validate does not reject
unknown properties by default, so a validation-success assertion would not
distinguish the raw schema from the augmented one. Spying on the
ConfigurationContainer call the CLI code path makes is a direct assertion on
the actual schema it used, without simulating per-field interactive prompts.
"""

from unittest import mock

from click.testing import CliRunner

from redash.cli import manager
from redash.utils.configuration import ConfigurationContainer
from tests import BaseTestCase


class TestDsNewUsesAugmentedSchema(BaseTestCase):
    def test_new_reads_the_augmented_schema_for_a_plain_sql_runner(self):
        runner = CliRunner()
        with mock.patch("redash.cli.data_sources.ConfigurationContainer", wraps=ConfigurationContainer) as container:
            result = runner.invoke(
                manager,
                [
                    "ds",
                    "new",
                    "test",
                    "--options",
                    '{"host": "example.com", "dbname": "testdb"}',
                    "--type",
                    "pg",
                ],
            )
        self.assertFalse(result.exception)
        self.assertEqual(result.exit_code, 0)
        schema = container.call_args.args[1]
        self.assertIn("enable_historical_capture", schema["properties"])
        self.assertIn("capture_manual_runs", schema["properties"])
        self.assertIn("historical_retention_days", schema["properties"])
