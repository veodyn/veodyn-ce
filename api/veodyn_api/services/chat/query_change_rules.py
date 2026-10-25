import re
from datetime import datetime
from typing import Any

from veodyn_api.services.chat.parameter_rules import check_definitions
from veodyn_api.services.chat.tools import positive_id

MAX_SQL_CHARS = 50_000
MAX_NAME_CHARS = 255
MAX_DESCRIPTION_CHARS = 4_096
MAX_TAGS = 20
MAX_TAG_CHARS = 64
SCHEDULE_INTERVALS = (0, 60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 604800)
SCHEDULE_KEYS = ("interval", "time", "dayOfWeek", "until")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DAILY_INTERVAL = 86_400
WEEKLY_INTERVAL = 604_800
CHANGE_FIELDS = ("sql", "name", "description", "dataSourceId", "tags", "parameters", "schedule", "isDraft")


def _text_problem(field: str, value: Any, limit: int) -> str | None:
    if isinstance(value, str) and value.strip() and len(value) <= limit:
        return None
    return f"changes.{field} must be a non-empty string of at most {limit} characters"


def _is_date(value: str) -> bool:
    if not DATE_RE.match(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _schedule_format_problem(schedule: dict[str, Any]) -> str | None:
    time, day, until = schedule.get("time"), schedule.get("dayOfWeek"), schedule.get("until")
    if time is not None and not (isinstance(time, str) and TIME_RE.match(time)):
        return "changes.schedule.time must be a 24-hour HH:MM time such as 06:00, or null"
    if day is not None and day not in WEEKDAYS:
        return f"changes.schedule.dayOfWeek must be one of {', '.join(WEEKDAYS)}, or null"
    if until is not None and not (isinstance(until, str) and _is_date(until)):
        return "changes.schedule.until must be a date written YYYY-MM-DD, or null"
    return None


def _schedule_problem(schedule: Any) -> str | None:
    if schedule is None:
        return None
    if not isinstance(schedule, dict):
        return "changes.schedule must be an object, or null to clear the schedule"
    for key in schedule:
        if key not in SCHEDULE_KEYS:
            return f"changes.schedule.{key} is not a schedule field; the fields are {', '.join(SCHEDULE_KEYS)}"
    interval = schedule.get("interval")
    if not isinstance(interval, int) or isinstance(interval, bool) or interval not in SCHEDULE_INTERVALS:
        return f"changes.schedule.interval must be one of {', '.join(str(one) for one in SCHEDULE_INTERVALS)} seconds"
    problem = _schedule_format_problem(schedule)
    if problem:
        return problem
    if schedule.get("time") is not None and interval < DAILY_INTERVAL:
        return "changes.schedule.time applies only to an interval of a day (86400) or more"
    if schedule.get("dayOfWeek") is not None and interval != WEEKLY_INTERVAL:
        return "changes.schedule.dayOfWeek applies only to a weekly interval (604800)"
    if schedule.get("dayOfWeek") is not None and schedule.get("time") is None:
        return "changes.schedule.time is required with dayOfWeek: node ignores the day without a time"
    if interval == WEEKLY_INTERVAL:
        for key in ("time", "dayOfWeek"):
            if schedule.get(key) is None:
                return f"changes.schedule.{key} is required for a weekly interval (604800)"
    return None


def _tags_problem(tags: Any) -> str | None:
    if (
        isinstance(tags, list)
        and len(tags) <= MAX_TAGS
        and all(isinstance(one, str) and one.strip() and len(one) <= MAX_TAG_CHARS for one in tags)
    ):
        return None
    return f"changes.tags must be a list of at most {MAX_TAGS} tags of up to {MAX_TAG_CHARS} characters each"


def _description_problem(description: Any) -> str | None:
    if description is None or (isinstance(description, str) and len(description) <= MAX_DESCRIPTION_CHARS):
        return None
    return f"changes.description must be a string of at most {MAX_DESCRIPTION_CHARS} characters"


def _parameters_problem(parameters: Any) -> str | None:
    problem = check_definitions(parameters)
    return f"changes.parameters: {problem}" if problem else None


def _data_source_problem(value: Any) -> str | None:
    if positive_id(value) is not None:
        return None
    return "changes.dataSourceId must be the id of a data source from list_data_sources"


def _draft_problem(value: Any) -> str | None:
    return None if isinstance(value, bool) else "changes.isDraft must be true or false"


def check_changes(changes: dict[str, Any]) -> str | None:
    for key in changes:
        if key not in CHANGE_FIELDS:
            return f"changes.{key} is not a field update_query can change; the fields are {', '.join(CHANGE_FIELDS)}"
    checks = {
        "sql": lambda value: _text_problem("sql", value, MAX_SQL_CHARS),
        "name": lambda value: _text_problem("name", value, MAX_NAME_CHARS),
        "description": _description_problem,
        "dataSourceId": _data_source_problem,
        "tags": _tags_problem,
        "parameters": _parameters_problem,
        "schedule": _schedule_problem,
        "isDraft": _draft_problem,
    }
    for field, check in checks.items():
        if field in changes:
            problem = check(changes[field])
            if problem:
                return problem
    return None
