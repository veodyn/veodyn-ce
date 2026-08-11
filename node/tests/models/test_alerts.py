import textwrap
from unittest import TestCase

from redash import settings
from redash.models import OPERATORS, Alert, db, next_state
from tests import BaseTestCase


class TestAlertAll(BaseTestCase):
    def test_returns_all_alerts_for_given_groups(self):
        ds1 = self.factory.data_source
        group = self.factory.create_group()
        ds2 = self.factory.create_data_source(group=group)

        query1 = self.factory.create_query(data_source=ds1)
        query2 = self.factory.create_query(data_source=ds2)

        alert1 = self.factory.create_alert(query_rel=query1)
        alert2 = self.factory.create_alert(query_rel=query2)
        db.session.flush()

        alerts = Alert.all(group_ids=[group.id, self.factory.default_group.id])
        self.assertIn(alert1, alerts)
        self.assertIn(alert2, alerts)

        alerts = Alert.all(group_ids=[self.factory.default_group.id])
        self.assertIn(alert1, alerts)
        self.assertNotIn(alert2, alerts)

        alerts = Alert.all(group_ids=[group.id])
        self.assertNotIn(alert1, alerts)
        self.assertIn(alert2, alerts)

    def test_return_each_alert_only_once(self):
        group = self.factory.create_group()
        self.factory.data_source.add_group(group)

        alert = self.factory.create_alert()

        alerts = Alert.all(group_ids=[self.factory.default_group.id, group.id])
        self.assertEqual(1, len(list(alerts)))
        self.assertIn(alert, alerts)


def get_results(value):
    return {"rows": [{"foo": value}], "columns": [{"name": "foo", "type": "STRING"}]}


class TestAlertEvaluate(BaseTestCase):
    def create_alert(self, results, column="foo", value="1"):
        result = self.factory.create_query_result(data=results)
        query = self.factory.create_query(latest_query_data_id=result.id)
        alert = self.factory.create_alert(
            query_rel=query, options={"selector": "first", "op": "equals", "column": column, "value": value}
        )
        return alert

    def test_evaluate_triggers_alert_when_equal(self):
        alert = self.create_alert(get_results(1))
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)

    def test_evaluate_number_value_and_string_threshold(self):
        alert = self.create_alert(get_results(1), value="string")
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluate_return_unknown_when_missing_column(self):
        alert = self.create_alert(get_results(1), column="bar")
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluate_return_unknown_when_empty_results(self):
        results = {"rows": [], "columns": [{"name": "foo", "type": "STRING"}]}
        alert = self.create_alert(results)
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluates_correctly_with_first_selector(self):
        results = {"rows": [{"foo": 1}, {"foo": 2}], "columns": [{"name": "foo", "type": "INTEGER"}]}
        alert = self.create_alert(results)
        alert.options["selector"] = "first"
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)
        results = {
            "rows": [{"foo": "test"}, {"foo": "test"}, {"foo": "test"}],
            "columns": [{"name": "foo", "type": "STRING"}],
        }
        alert = self.create_alert(results)
        alert.options["selector"] = "first"
        alert.options["op"] = "<"
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluates_correctly_with_min_selector(self):
        results = {"rows": [{"foo": 2}, {"foo": 1}], "columns": [{"name": "foo", "type": "INTEGER"}]}
        alert = self.create_alert(results)
        alert.options["selector"] = "min"
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)
        results = {
            "rows": [{"foo": "test"}, {"foo": "test"}, {"foo": "test"}],
            "columns": [{"name": "foo", "type": "STRING"}],
        }
        alert = self.create_alert(results)
        alert.options["selector"] = "min"
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluates_correctly_with_max_selector(self):
        results = {"rows": [{"foo": 1}, {"foo": 2}], "columns": [{"name": "foo", "type": "INTEGER"}]}
        alert = self.create_alert(results)
        alert.options["selector"] = "max"
        self.assertEqual(alert.evaluate(), Alert.OK_STATE)
        results = {
            "rows": [{"foo": "test"}, {"foo": "test"}, {"foo": "test"}],
            "columns": [{"name": "foo", "type": "STRING"}],
        }
        alert = self.create_alert(results)
        alert.options["selector"] = "max"
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluate_alerts_without_query_rel(self):
        query = self.factory.create_query(latest_query_data_id=None)
        alert = self.factory.create_alert(
            query_rel=query, options={"selector": "first", "op": "equals", "column": "foo", "value": "1"}
        )
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluate_return_unknown_when_value_is_none(self):
        alert = self.create_alert(get_results(None))
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_evaluates_correctly_with_last_selector(self):
        # Three rows on purpose. The obvious two-row fixture makes `last` and
        # `max` return the same number, so an implementation that aliased one to
        # the other would pass. Against a threshold of "2": first=1 OK, min=1 OK,
        # max=3 OK, last=2 TRIGGERED. Only `last` triggers.
        results = {
            "rows": [{"foo": 1}, {"foo": 3}, {"foo": 2}],
            "columns": [{"name": "foo", "type": "INTEGER"}],
        }
        alert = self.create_alert(results, value="2")
        alert.options["selector"] = "last"
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)

        for selector in ("first", "min", "max"):
            alert = self.create_alert(results, value="2")
            alert.options["selector"] = selector
            self.assertEqual(alert.evaluate(), Alert.OK_STATE, selector)

    def test_last_selector_returns_unknown_for_a_string_column(self):
        # The rows differ on purpose. An all-string fixture gives UNKNOWN whether
        # the first row or the last one is read, so it would pass against the old
        # code too and prove nothing about the selector. A numeric first row and a
        # string last row separate them: reading the first compares 5 against 1
        # and answers OK, reading the last cannot compare at all.
        results = {
            "rows": [{"foo": 5}, {"foo": "test"}],
            "columns": [{"name": "foo", "type": "STRING"}],
        }
        alert = self.create_alert(results)
        alert.options["selector"] = "last"
        alert.options["op"] = "<"
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_min_and_max_now_read_a_boolean_column_the_way_first_does(self):
        # A deliberate behaviour change, recorded rather than hidden. The old
        # min/max loop coerced every cell with float(), so a boolean column
        # reached next_state as 0.0 or 1.0, and comparing it against "false"
        # answered UNKNOWN (float("false") raises). Returning the stored cell
        # sends the bool itself, which next_state renders as "false"/"true" and
        # compares as a string, so this now TRIGGERS.
        #
        # The new answer is also the consistent one: the first and last
        # selectors have always returned the raw cell, so booleans already
        # behaved this way for them. min/max were the odd ones out.
        results = {
            "rows": [{"foo": False}, {"foo": True}],
            "columns": [{"name": "foo", "type": "BOOLEAN"}],
        }
        alert = self.create_alert(results, value="false")
        alert.options["op"] = "=="
        alert.options["selector"] = "min"
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)

        alert.options["selector"] = "first"
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)

    def test_a_column_missing_from_the_last_row_does_not_raise(self):
        # The old guard tested `column in rows[0]` and then let the selector
        # index a different row, so a ragged result raised KeyError out of
        # evaluate(): the surrounding try catches only ValueError, so it escaped
        # into the alert job rather than answering UNKNOWN.
        results = {"rows": [{"foo": 1}, {"bar": 2}], "columns": [{"name": "foo", "type": "INTEGER"}]}
        alert = self.create_alert(results)
        alert.options["selector"] = "last"
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

    def test_a_column_present_only_in_the_last_row_is_read(self):
        # The mirror. Guarding on the first row alone reported UNKNOWN for a
        # value the selector could see perfectly well.
        results = {"rows": [{"bar": 1}, {"foo": 2}], "columns": [{"name": "foo", "type": "INTEGER"}]}
        alert = self.create_alert(results, value="2")
        alert.options["selector"] = "last"
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)

    def test_a_value_exactly_on_the_threshold_is_ok_under_strict_less_than(self):
        # This boundary is a contract, not an accident. veodyn-api's
        # kpi_eval.status_for_value breaches a higher-is-better KPI on
        # `value < breached`, so exactly-at-breached is NOT breached, and the
        # derived alert relies on Redash's "<" agreeing. If this ever becomes
        # "<=", the two halves disagree at the boundary and a KPI reads on-track
        # while its alert says triggered.
        results = {"rows": [{"foo": 5}], "columns": [{"name": "foo", "type": "INTEGER"}]}
        alert = self.create_alert(results, value="5")
        alert.options["selector"] = "last"
        alert.options["op"] = "<"
        self.assertEqual(alert.evaluate(), Alert.OK_STATE)

        alert = self.create_alert(results, value="6")
        alert.options["selector"] = "last"
        alert.options["op"] = "<"
        self.assertEqual(alert.evaluate(), Alert.TRIGGERED_STATE)


class TestNextState(TestCase):
    def test_numeric_value(self):
        self.assertEqual(Alert.TRIGGERED_STATE, next_state(OPERATORS.get("=="), 1, "1"))
        self.assertEqual(Alert.TRIGGERED_STATE, next_state(OPERATORS.get("=="), 1, "1.0"))
        self.assertEqual(Alert.TRIGGERED_STATE, next_state(OPERATORS.get(">"), "5", 1))

    def test_numeric_value_and_plain_string(self):
        self.assertEqual(Alert.UNKNOWN_STATE, next_state(OPERATORS.get("=="), 1, "string"))

    def test_non_numeric_value(self):
        self.assertEqual(Alert.OK_STATE, next_state(OPERATORS.get("=="), "string", "1.0"))

    def test_string_value(self):
        self.assertEqual(Alert.TRIGGERED_STATE, next_state(OPERATORS.get("=="), "string", "string"))

    def test_boolean_value(self):
        self.assertEqual(Alert.TRIGGERED_STATE, next_state(OPERATORS.get("=="), False, "false"))
        self.assertEqual(Alert.TRIGGERED_STATE, next_state(OPERATORS.get("!="), False, "true"))


class TestAlertRenderTemplate(BaseTestCase):
    def create_alert(self, results, column="foo", value="5"):
        result = self.factory.create_query_result(data=results)
        query = self.factory.create_query(latest_query_data_id=result.id)
        alert = self.factory.create_alert(
            query_rel=query, options={"selector": "first", "op": "equals", "column": column, "value": value}
        )
        return alert

    def test_render_custom_alert_template(self):
        alert = self.create_alert(get_results(1))
        custom_alert = """
        <pre>
        ALERT_STATUS        {{ALERT_STATUS}}
        ALERT_SELECTOR      {{ALERT_SELECTOR}}
        ALERT_CONDITION     {{ALERT_CONDITION}}
        ALERT_THRESHOLD     {{ALERT_THRESHOLD}}
        ALERT_NAME          {{ALERT_NAME}}
        ALERT_URL           {{{ALERT_URL}}}
        QUERY_NAME          {{QUERY_NAME}}
        QUERY_URL           {{{QUERY_URL}}}
        QUERY_RESULT_VALUE  {{QUERY_RESULT_VALUE}}
        QUERY_RESULT_ROWS   {{{QUERY_RESULT_ROWS}}}
        QUERY_RESULT_COLS   {{{QUERY_RESULT_COLS}}}
        </pre>
        """
        expected = """
        <pre>
        ALERT_STATUS        UNKNOWN
        ALERT_SELECTOR      first
        ALERT_CONDITION     equals
        ALERT_THRESHOLD     5
        ALERT_NAME          %s
        ALERT_URL           %s/default/alerts/%d
        QUERY_NAME          Query
        QUERY_URL           %s/default/queries/%d
        QUERY_RESULT_VALUE  1
        QUERY_RESULT_ROWS   [{'foo': 1}]
        QUERY_RESULT_COLS   [{'name': 'foo', 'type': 'STRING'}]
        </pre>
        """ % (
            alert.name,
            settings.HOST,
            alert.id,
            settings.HOST,
            alert.query_id,
        )
        result = alert.render_template(textwrap.dedent(custom_alert))
        self.assertMultiLineEqual(result, textwrap.dedent(expected))

    def test_query_result_value_follows_the_selector(self):
        # render_template built QUERY_RESULT_VALUE from rows[0] unconditionally,
        # which already misreported every min and max alert. Under `last` it
        # would mean an alert fires correctly on the newest reading and then
        # tells the recipient the oldest one.
        #
        # Four rows chosen so first, last, min and max are four DIFFERENT
        # numbers. The obvious [1, 3, 2] fixture has min == first, so a renderer
        # that still returned row one would have passed the min case.
        results = {
            "rows": [{"foo": 5}, {"foo": 9}, {"foo": 2}, {"foo": 7}],
            "columns": [{"name": "foo", "type": "INTEGER"}],
        }
        alert = self.create_alert(results)
        for selector, expected in (("first", "5"), ("last", "7"), ("min", "2"), ("max", "9")):
            alert.options["selector"] = selector
            self.assertEqual(alert.render_template("{{QUERY_RESULT_VALUE}}"), expected, selector)

    def test_a_nested_cell_does_not_break_the_notification(self):
        # min/max order the cells with float(), and float([]) raises TypeError,
        # not ValueError. Rendering never coerced the column before this change,
        # so an uncaught TypeError here would fail the whole notification for a
        # query whose result merely contains a nested value, which a JSON data
        # source produces routinely. The message goes out with an empty value.
        results = {
            "rows": [{"foo": [1, 2]}, {"foo": 3}],
            "columns": [{"name": "foo", "type": "STRING"}],
        }
        alert = self.create_alert(results)
        alert.options["selector"] = "max"
        # "None", not "": mustache renders a None context value as the string,
        # and that is the behaviour a missing column already had here, so this
        # asserts the established answer rather than a nicer one. What matters
        # is that render_template RETURNS at all.
        self.assertEqual(alert.render_template("{{QUERY_RESULT_VALUE}}"), "None")
        self.assertEqual(alert.evaluate(), Alert.UNKNOWN_STATE)

        # `first` reads the cell without ordering anything, so it never coerces
        # and the nested value reaches the template intact. Only min and max
        # have to survive a cell they cannot compare.
        alert.options["selector"] = "first"
        self.assertEqual(alert.render_template("{{QUERY_RESULT_VALUE}}"), "[1, 2]")

    def test_render_custom_alert_template_query_table(self):
        alert = self.create_alert(get_results(1))
        custom_alert = """
        <table>
        {{#QUERY_RESULT_TABLE}}
          <tr>
            {{#.}}
            <td>{{.}}</td>
            {{/.}}
          </tr>
        {{/QUERY_RESULT_TABLE}}
        </table>
        """
        expected = """
        <table>
          <tr>
            <td>1</td>
          </tr>
        </table>
        """
        result = alert.render_template(textwrap.dedent(custom_alert))
        self.assertMultiLineEqual(result, textwrap.dedent(expected))
