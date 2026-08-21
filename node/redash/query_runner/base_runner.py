import logging
from collections import defaultdict

import sqlparse

from redash import settings, utils
from redash.query_runner.capture_fields import add_historical_capture_fields
from redash.query_runner.sql_statements import (
    combine_sql_statements,
    find_last_keyword_idx,
    split_sql_statements,
)

logger = logging.getLogger(__name__)


class InterruptException(Exception):
    pass


class NotSupported(Exception):
    pass


class BaseQueryRunner:
    deprecated = False
    should_annotate_query = True
    noop_query = None
    limit_query = " LIMIT 1000"
    limit_keywords = ["LIMIT", "OFFSET"]
    limit_after_select = False

    def __init__(self, configuration):
        self.syntax = "sql"
        self.configuration = configuration

    @classmethod
    def name(cls):
        return cls.__name__

    @classmethod
    def type(cls):
        return cls.__name__.lower()

    @classmethod
    def enabled(cls):
        return True

    @property
    def host(self):
        """Returns this query runner's configured host.
        This is used primarily for temporarily swapping endpoints when using SSH tunnels to connect to a data source.

        `BaseQueryRunner`'s naïve implementation supports query runner implementations that store endpoints using `host` and `port`
        configuration values. If your query runner uses a different schema (e.g. a web address), you should override this function.
        """
        if "host" in self.configuration:
            return self.configuration["host"]
        else:
            raise NotImplementedError()

    @host.setter
    def host(self, host):
        """Sets this query runner's configured host.
        This is used primarily for temporarily swapping endpoints when using SSH tunnels to connect to a data source.

        `BaseQueryRunner`'s naïve implementation supports query runner implementations that store endpoints using `host` and `port`
        configuration values. If your query runner uses a different schema (e.g. a web address), you should override this function.
        """
        if "host" in self.configuration:
            self.configuration["host"] = host
        else:
            raise NotImplementedError()

    @property
    def port(self):
        """Returns this query runner's configured port.
        This is used primarily for temporarily swapping endpoints when using SSH tunnels to connect to a data source.

        `BaseQueryRunner`'s naïve implementation supports query runner implementations that store endpoints using `host` and `port`
        configuration values. If your query runner uses a different schema (e.g. a web address), you should override this function.
        """
        if "port" in self.configuration:
            return self.configuration["port"]
        else:
            raise NotImplementedError()

    @port.setter
    def port(self, port):
        """Sets this query runner's configured port.
        This is used primarily for temporarily swapping endpoints when using SSH tunnels to connect to a data source.

        `BaseQueryRunner`'s naïve implementation supports query runner implementations that store endpoints using `host` and `port`
        configuration values. If your query runner uses a different schema (e.g. a web address), you should override this function.
        """
        if "port" in self.configuration:
            self.configuration["port"] = port
        else:
            raise NotImplementedError()

    @classmethod
    def configuration_schema(cls):
        return {}

    def annotate_query(self, query, metadata):
        if not self.should_annotate_query:
            return query

        annotation = ", ".join(["{}: {}".format(k, v) for k, v in metadata.items()])
        annotated_query = "/* {} */ {}".format(annotation, query)
        return annotated_query

    def test_connection(self):
        if self.noop_query is None:
            raise NotImplementedError()
        data, error = self.run_query(self.noop_query, None)

        if error is not None:
            raise Exception(error)

    def run_query(self, query, user):
        raise NotImplementedError()

    def fetch_columns(self, columns):
        column_names = set()
        duplicates_counters = defaultdict(int)
        new_columns = []

        for col in columns:
            column_name = col[0]
            while column_name in column_names:
                duplicates_counters[col[0]] += 1
                column_name = "{}{}".format(col[0], duplicates_counters[col[0]])

            column_names.add(column_name)
            new_columns.append({"name": column_name, "friendly_name": column_name, "type": col[1]})

        return new_columns

    def get_schema(self, get_stats=False):
        raise NotSupported()

    def _handle_run_query_error(self, error):
        if error is None:
            return

        logger.error(error)
        raise Exception(f"Error during query execution. Reason: {error}")

    def _run_query_internal(self, query):
        results, error = self.run_query(query, None)

        if error is not None:
            raise Exception("Failed running query [%s]." % query)
        return results["rows"]

    @classmethod
    def to_dict(cls):
        return {
            "name": cls.name(),
            "type": cls.type(),
            "configuration_schema": add_historical_capture_fields(cls.configuration_schema()),
            **({"deprecated": True} if cls.deprecated else {}),
        }

    @property
    def supports_auto_limit(self):
        return False

    def apply_auto_limit(self, query_text, should_apply_auto_limit):
        return query_text

    def gen_query_hash(self, query_text, set_auto_limit=False):
        query_text = self.apply_auto_limit(query_text, set_auto_limit)
        return utils.gen_query_hash(query_text)


class BaseSQLQueryRunner(BaseQueryRunner):
    def get_schema(self, get_stats=False):
        schema_dict = {}
        self._get_tables(schema_dict)
        if settings.SCHEMA_RUN_TABLE_SIZE_CALCULATIONS and get_stats:
            self._get_tables_stats(schema_dict)
        return list(schema_dict.values())

    def _get_tables(self, schema_dict):
        return []

    def _get_tables_stats(self, tables_dict):
        for t in tables_dict.keys():
            if isinstance(tables_dict[t], dict):
                res = self._run_query_internal("select count(*) as cnt from %s" % t)
                tables_dict[t]["size"] = res[0]["cnt"]

    @property
    def supports_auto_limit(self):
        return True

    def query_is_select_no_limit(self, query):
        parsed_query_list = sqlparse.parse(query)
        if len(parsed_query_list) == 0:
            return False
        parsed_query = parsed_query_list[0]
        last_keyword_idx = find_last_keyword_idx(parsed_query)
        # Either invalid query or query that is not select
        if last_keyword_idx == -1 or parsed_query.tokens[0].value.upper() != "SELECT":
            return False

        no_limit = parsed_query.tokens[last_keyword_idx].value.upper() not in self.limit_keywords

        return no_limit

    def add_limit_to_query(self, query):
        parsed_query = sqlparse.parse(query)[0]
        limit_tokens = sqlparse.parse(self.limit_query)[0].tokens
        length = len(parsed_query.tokens)
        if not self.limit_after_select:
            if parsed_query.tokens[length - 1].ttype == sqlparse.tokens.Punctuation:
                parsed_query.tokens[length - 1 : length - 1] = limit_tokens
            else:
                parsed_query.tokens += limit_tokens
        else:
            for i in range(length - 1, -1, -1):
                if parsed_query[i].value.upper() == "SELECT":
                    index = parsed_query.token_index(parsed_query[i + 1])
                    parsed_query = sqlparse.sql.Statement(
                        parsed_query.tokens[:index] + limit_tokens + parsed_query.tokens[index:]
                    )
                    break
        return str(parsed_query)

    def apply_auto_limit(self, query_text, should_apply_auto_limit):
        queries = split_sql_statements(query_text)
        if should_apply_auto_limit:
            # we only check for last one in the list because it is the one that we show result
            last_query = queries[-1]
            if self.query_is_select_no_limit(last_query):
                queries[-1] = self.add_limit_to_query(last_query)
        return combine_sql_statements(queries)
