"""Running one `/validate-static` request through `gtfs_validator.pipeline`.

`run_validation` there is the package's own non-CLI entry point (`cli.py`'s
`main` is the other caller of it). This module builds the same two reports
`cli.py` writes to `report.json` and `system_errors.json`, using the package's
own `report` and `summary` builders and its own `Register`, without any of the
CLI's argument parsing, file writing or HTML output.

An archive that cannot be opened at all is not raised as an exception:
`run_validation` records it in `system_errors` and returns `(None, False)`,
the same as a feed that opened but failed a table midway (see the package's
own `pipeline.run_validation` docstring). Since the package itself treats both
as "processed, with a failure recorded" rather than "the request was invalid",
this module always returns a result; the caller answers 200 either way.

The returned dict still holds raw builder objects (a notice's context can
carry a `Decimal`, per the package's own `typing_checks.check_number`), so it
must be serialized with `gtfs_validator.report.dumps_json`, not handed to
`fastapi.responses.JSONResponse` directly; `routes.py` does that.
"""

from __future__ import annotations

import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

from gtfs_validator.notices import NoticeContainer
from gtfs_validator.pipeline import run_validation
from gtfs_validator.report import build_report, build_system_errors
from gtfs_validator.summary import Register, RunConfig, build_summary
from gtfs_validator.version import VERSION

#: `cliargs.country_code(None)`'s placeholder: no country was given.
_UNKNOWN_COUNTRY = "ZZ"


def validate_static_archive(archive_path: Path, *, gtfs_input: str) -> dict[str, Any]:
    """The `{"report": ..., "systemErrors": ...}` the endpoint returns.

    `gtfs_input` names the source for the summary's `gtfsInput` field: the
    request's `gtfs` URL, or the uploaded file's name.
    """
    notices = NoticeContainer()
    system_errors = NoticeContainer()
    validation_date = date.today()
    register = Register.new()
    started = time.monotonic()

    facts, opened = run_validation(
        archive_path,
        notices,
        system_errors,
        validation_date=validation_date,
        register=register,
    )
    # Matches cli.py: one more reading after run_validation returns, taken
    # unconditionally, the same as the checkpoints run_validation itself
    # records while the tables are open.
    register.register("validate")

    config = RunConfig(
        validator_version=VERSION,
        validated_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        gtfs_input=gtfs_input,
        threads=1,
        output_directory=None,
        system_errors_report_name=None,
        validation_report_name=None,
        html_report_name=None,
        country_code=_UNKNOWN_COUNTRY,
        date_for_validation=validation_date,
    )
    validation_time_seconds = time.monotonic() - started if opened else None
    report = {
        "summary": build_summary(config, facts, validation_time_seconds, register),
        **build_report(notices),
    }
    return {"report": report, "systemErrors": build_system_errors(system_errors)}
