import logging

from redash.query_runner.capture_fields import add_historical_capture_fields

logger = logging.getLogger(__name__)

query_runners = {}


def register(query_runner_class):
    global query_runners
    if query_runner_class.enabled():
        logger.debug(
            "Registering %s (%s) query runner.",
            query_runner_class.name(),
            query_runner_class.type(),
        )
        query_runners[query_runner_class.type()] = query_runner_class
    else:
        logger.debug(
            "%s query runner enabled but not supported, not registering. Either disable or install missing "
            "dependencies.",
            query_runner_class.name(),
        )


def get_query_runner(query_runner_type, configuration):
    query_runner_class = query_runners.get(query_runner_type, None)
    if query_runner_class is None:
        return None

    return query_runner_class(configuration)


def get_configuration_schema_for_query_runner_type(query_runner_type):
    query_runner_class = query_runners.get(query_runner_type, None)
    if query_runner_class is None:
        return None

    return add_historical_capture_fields(query_runner_class.configuration_schema())


def import_query_runners(query_runner_imports):
    for runner_import in query_runner_imports:
        __import__(runner_import)
