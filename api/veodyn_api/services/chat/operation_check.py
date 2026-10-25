import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from veodyn_api.schemas.ai_chat_operation import DESTRUCTIVE_OPERATIONS, ChatOperationCheckResultIn
from veodyn_api.services.chat.operation_handlers import refused
from veodyn_api.services.chat.tools import ClientCall, Immediate, ToolContext


@dataclass(frozen=True)
class Expected:
    op: str
    kind: str
    target_id: int
    query_id: int | None = None
    expires_at: str | None = None
    refresh_seconds: int | None = None


Expectation = Callable[[dict[str, Any]], Expected]


def expect_fork(args: dict[str, Any]) -> Expected:
    return Expected("fork", "query", args["queryId"])


def expect_archive(kind: str, id_name: str) -> Expectation:
    def expect(args: dict[str, Any]) -> Expected:
        return Expected("restore" if args["restore"] else "archive", kind, args[id_name])

    return expect


def expect_favorite(args: dict[str, Any]) -> Expected:
    return Expected("favorite" if args["favorite"] else "unfavorite", args["kind"], args["id"])


def expect_dashboard_share(args: dict[str, Any]) -> Expected:
    op = "share" if args["action"] == "create" else "revoke"
    return Expected(op, "dashboard", args["dashboardId"], expires_at=args.get("expiresAt"))


def expect_visualization_share(args: dict[str, Any]) -> Expected:
    op = "share" if args["action"] == "create" else "revoke"
    return Expected(
        op,
        "visualization",
        args["visualizationId"],
        query_id=args["queryId"],
        expires_at=args.get("expiresAt"),
        refresh_seconds=args.get("refreshSeconds"),
    )


def _mismatch(parsed: ChatOperationCheckResultIn, expected: Expected) -> str | None:
    target = parsed.target
    if target is None or parsed.op is None:
        return "the browser did not say what it checked"
    if parsed.op != expected.op:
        return f"the browser answered a {parsed.op} check for a {expected.op} request"
    if target.kind != expected.kind or target.id != expected.target_id:
        return f"the browser answered for {target.kind} {target.id}, not {expected.kind} {expected.target_id}"
    if expected.query_id is not None and target.query_id != expected.query_id:
        return f"the browser answered for a chart of query {target.query_id}, not query {expected.query_id}"
    if parsed.destructive != (parsed.op in DESTRUCTIVE_OPERATIONS):
        return f"destructive must be {str(parsed.op in DESTRUCTIVE_OPERATIONS).lower()} for a {parsed.op} operation"
    if parsed.op == "share":
        if parsed.params.get("expiresAt") != expected.expires_at:
            return "the checked expiry is not the one that was asked for"
        if parsed.params.get("refreshSeconds") != expected.refresh_seconds:
            return "the checked refresh cadence is not the one that was asked for"
    return None


def completer(expect: Expectation) -> Callable[[ClientCall, dict[str, Any], ToolContext], Awaitable[Immediate]]:
    async def complete(request: ClientCall, result: dict[str, Any], ctx: ToolContext) -> Immediate:
        parsed = ChatOperationCheckResultIn.model_validate(result)
        if parsed.problems:
            return refused("the operation was refused: " + "; ".join(parsed.problems))
        wrong = _mismatch(parsed, expect(request.args))
        if wrong is not None:
            return refused(wrong)
        assert parsed.target is not None
        payload: dict[str, Any] = {
            "op": parsed.op,
            "target": parsed.target.model_dump(by_alias=True, exclude_none=True),
            "params": parsed.params,
            "destructive": parsed.destructive,
        }
        if parsed.snapshot is not None:
            payload["snapshot"] = parsed.snapshot.model_dump(by_alias=True)
        draft_id, version = await ctx.save_draft("operation", None, payload)
        return Immediate(
            json.dumps({"draftId": draft_id, "version": version, "destructive": parsed.destructive}),
            is_error=False,
            draft={"draftId": draft_id, "version": version, "kind": "operation", "payload": payload},
        )

    return complete
