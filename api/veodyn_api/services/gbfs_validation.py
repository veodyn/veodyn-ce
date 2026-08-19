"""Running a serialized GBFS file set through gbfs-validator, in-process.

No service and no cache: the package has zero dependencies and no prepared
state, so validation is a local, sub-second call. The files are written to a
temporary directory and fetched over `file://`, which the package's fetcher
supports; the discovery copy it reads has its member urls rewritten to that
directory, and nothing else (a test holds that diff to urls-only).

Fail closed, never absent, the same doctrine as feed_validator.py: a report
that cannot be read as findings raises rather than passing. GBFS notices carry
no severity, so everything blocks and there is no warning tier.
"""

import copy
import json
import tempfile
from pathlib import Path
from typing import Any

# No py.typed in the distribution, so pyproject.toml carries the mypy override.
from gbfs_validator import GBFS

from veodyn_api.services.feed_validator import Finding, ValidationOutcome, ValidatorUnavailable


def discovery_for_validation(files: dict[str, Any], directory: str) -> dict[str, Any]:
    """The stored gbfs.json with member urls pointing into `directory`."""
    discovery: dict[str, Any] = copy.deepcopy(files["gbfs.json"])
    data = discovery.get("data") or {}
    # 3.0 holds one `feeds` list; pre-3.0 holds one group per language.
    groups = [data] if isinstance(data.get("feeds"), list) else [v for v in data.values() if isinstance(v, dict)]
    for group in groups:
        for entry in group.get("feeds") or []:
            entry["url"] = f"file://{directory}/{entry['name']}.json"
    return discovery


def _run(files: dict[str, Any], version: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as directory:
        try:
            for name, body in files.items():
                written = discovery_for_validation(files, directory) if name == "gbfs.json" else body
                Path(directory, name).write_text(json.dumps(written), encoding="utf-8")
            report = GBFS(f"file://{directory}/gbfs.json", docked=True, version=version).validation()
        except Exception as exc:
            raise ValidatorUnavailable(f"gbfs validator did not return a report: {exc}") from exc
    if not isinstance(report, dict):
        raise ValidatorUnavailable(f"gbfs validator returned a {type(report).__name__}, not a report object")
    return report


def _entry_errors(entry: dict[str, Any]) -> list[dict[str, Any]]:
    """The entry's AJV errors, from either the flat or the per-language shape."""
    errors = entry.get("errors")
    if isinstance(errors, list):
        return errors
    collected: list[dict[str, Any]] = []
    for language in entry.get("languages") or []:
        language_errors = language.get("errors")
        if isinstance(language_errors, list):
            collected.extend(language_errors)
    return collected


def _entry_exists(entry: dict[str, Any]) -> bool:
    languages = entry.get("languages")
    if isinstance(languages, list) and languages:
        return all(bool(language.get("exists")) for language in languages)
    return bool(entry.get("exists"))


def _findings_for(entry: dict[str, Any]) -> list[Finding]:
    name = str(entry.get("file") or "")
    if not name:
        raise ValidatorUnavailable("gbfs validator reported a file result with no file name")

    findings: list[Finding] = []
    if entry.get("required") and not _entry_exists(entry):
        findings.append(
            Finding(
                rule_id=f"{name}:missing",
                severity="ERROR",
                title="required file is not published",
                locator="",
                occurrence_count=1,
            )
        )

    groups: dict[str, list[dict[str, Any]]] = {}
    for error in _entry_errors(entry):
        if not isinstance(error, dict):
            raise ValidatorUnavailable(f"gbfs validator reported an error on {name} that is not an object")
        groups.setdefault(str(error.get("schemaPath") or ""), []).append(error)
    for schema_path, errors in groups.items():
        for error in errors:
            findings.append(
                Finding(
                    rule_id=f"{name}#{schema_path}",
                    severity="ERROR",
                    title=str(error.get("message") or ""),
                    locator=str(error.get("instancePath") or ""),
                    occurrence_count=len(errors),
                )
            )
    return findings


def validate_gbfs_files(files: dict[str, Any], version: str) -> ValidationOutcome:
    """One serialized file set against its GBFS version. Raises rather than guessing."""
    report = _run(files, version)
    # `or {}` would turn an absent summary into a clean verdict, which is the one
    # shape this adapter exists to refuse: no summary means no verdict at all.
    summary = report.get("summary")
    if not isinstance(summary, dict):
        raise ValidatorUnavailable(
            f"gbfs validator returned no summary object (summary is a {type(summary).__name__})"
        )
    if summary.get("versionUnimplemented"):
        raise ValidatorUnavailable(f"gbfs validator does not implement version {version!r}")
    if "hasErrors" not in summary:
        raise ValidatorUnavailable("gbfs validator's report does not say whether the feed has errors")

    entries = report.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValidatorUnavailable("gbfs validator returned no file results; an absent report is not an empty one")

    findings: list[Finding] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValidatorUnavailable(f"gbfs validator reported a file result that is a {type(entry).__name__}")
        findings.extend(_findings_for(entry))

    if summary.get("hasErrors") and not findings:
        raise ValidatorUnavailable("gbfs validator reports errors this adapter could not read")

    enabled = tuple(str(entry["file"]) for entry in entries)
    return ValidationOutcome(findings=tuple(findings), enabled_rules=enabled)
