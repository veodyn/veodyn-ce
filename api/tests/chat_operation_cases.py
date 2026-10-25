from typing import Any

from veodyn_api.services.chat.tools import ClientCall

LATER = "2026-12-01T00:00:00Z"


def request(tool: str, **args: Any) -> ClientCall:
    return ClientCall(call_id="call-1", tool=tool, args=args)


def check(op: str, target: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "kind": "operation_check",
        "op": op,
        "target": target,
        "params": {},
        "destructive": op in ("archive", "revoke"),
        "problems": [],
        **extra,
    }


QUERY = {"kind": "query", "id": 7, "name": "Weekly revenue"}
DASHBOARD = {"kind": "dashboard", "id": 3, "name": "Ops"}
VISUALIZATION = {"kind": "visualization", "id": 31, "name": "Chart", "queryId": 7}

HANDLER_CASES = [
    ("fork_query", {"queryId": 7}, {"queryId": 7}),
    ("archive_query", {"queryId": 7}, {"queryId": 7, "restore": False}),
    ("archive_query", {"queryId": 7, "restore": True}, {"queryId": 7, "restore": True}),
    ("archive_dashboard", {"dashboardId": 3}, {"dashboardId": 3, "restore": False}),
    ("archive_dashboard", {"dashboardId": 3, "restore": True}, {"dashboardId": 3, "restore": True}),
    ("set_favorite", {"kind": "query", "id": 7, "favorite": True}, {"kind": "query", "id": 7, "favorite": True}),
    (
        "set_favorite",
        {"kind": "dashboard", "id": 3, "favorite": False},
        {"kind": "dashboard", "id": 3, "favorite": False},
    ),
    (
        "share_dashboard",
        {"dashboardId": 3, "action": "create"},
        {"dashboardId": 3, "action": "create", "expiresAt": None},
    ),
    (
        "share_dashboard",
        {"dashboardId": 3, "action": "create", "expiresAt": LATER},
        {"dashboardId": 3, "action": "create", "expiresAt": LATER},
    ),
    (
        "share_dashboard",
        {"dashboardId": 3, "action": "revoke"},
        {"dashboardId": 3, "action": "revoke", "expiresAt": None},
    ),
    (
        "share_visualization",
        {"queryId": 7, "visualizationId": 31, "action": "create", "refreshSeconds": 60},
        {"queryId": 7, "visualizationId": 31, "action": "create", "expiresAt": None, "refreshSeconds": 60},
    ),
    (
        "share_visualization",
        {"queryId": 7, "visualizationId": 31, "action": "revoke"},
        {"queryId": 7, "visualizationId": 31, "action": "revoke", "expiresAt": None, "refreshSeconds": None},
    ),
    ("download_result", {"queryId": 7, "format": "xlsx"}, {"queryId": 7, "format": "xlsx"}),
]

REFUSED_ARGUMENTS = [
    ("fork_query", {}, "queryId"),
    ("fork_query", {"queryId": 0}, "queryId"),
    ("fork_query", {"queryId": "7"}, "queryId"),
    ("archive_query", {"queryId": True}, "queryId"),
    ("archive_query", {"queryId": 7, "restore": "yes"}, "restore"),
    ("archive_dashboard", {"dashboardId": -1}, "dashboardId"),
    ("set_favorite", {"kind": "report", "id": 7, "favorite": True}, "kind"),
    ("set_favorite", {"kind": "query", "id": 0, "favorite": True}, "id"),
    ("set_favorite", {"kind": "query", "id": 7}, "favorite"),
    ("set_favorite", {"kind": "query", "id": 7, "favorite": "true"}, "favorite"),
    ("share_dashboard", {"dashboardId": 3, "action": "delete"}, "action"),
    ("share_dashboard", {"dashboardId": 3}, "action"),
    ("share_dashboard", {"action": "create"}, "dashboardId"),
    ("share_dashboard", {"dashboardId": 3, "action": "create", "expiresAt": "tomorrow"}, "expiresAt"),
    ("share_dashboard", {"dashboardId": 3, "action": "create", "expiresAt": LATER + "0" * 30}, "expiresAt"),
    ("share_dashboard", {"dashboardId": 3, "action": "create", "expiresAt": 5}, "expiresAt"),
    ("share_dashboard", {"dashboardId": 3, "action": "revoke", "expiresAt": LATER}, "expiresAt"),
    ("share_visualization", {"queryId": 7, "action": "create"}, "visualizationId"),
    ("share_visualization", {"visualizationId": 31, "action": "create"}, "queryId"),
    (
        "share_visualization",
        {"queryId": 7, "visualizationId": 31, "action": "create", "refreshSeconds": 10},
        "refreshSeconds",
    ),
    (
        "share_visualization",
        {"queryId": 7, "visualizationId": 31, "action": "create", "refreshSeconds": "60"},
        "refreshSeconds",
    ),
    (
        "share_visualization",
        {"queryId": 7, "visualizationId": 31, "action": "revoke", "refreshSeconds": 60},
        "refreshSeconds",
    ),
    ("download_result", {"queryId": 7, "format": "pdf"}, "format"),
    ("download_result", {"format": "csv"}, "queryId"),
]

ACCEPTED_ANSWERS = [
    ("fork_query", {"queryId": 7}, "fork", QUERY),
    ("archive_query", {"queryId": 7, "restore": False}, "archive", QUERY),
    ("archive_query", {"queryId": 7, "restore": True}, "restore", QUERY),
    ("archive_dashboard", {"dashboardId": 3, "restore": False}, "archive", DASHBOARD),
    ("archive_dashboard", {"dashboardId": 3, "restore": True}, "restore", DASHBOARD),
    ("set_favorite", {"kind": "dashboard", "id": 3, "favorite": True}, "favorite", DASHBOARD),
    ("set_favorite", {"kind": "query", "id": 7, "favorite": False}, "unfavorite", QUERY),
    ("share_dashboard", {"dashboardId": 3, "action": "create"}, "share", DASHBOARD),
    ("share_dashboard", {"dashboardId": 3, "action": "revoke"}, "revoke", DASHBOARD),
    ("share_visualization", {"queryId": 7, "visualizationId": 31, "action": "create"}, "share", VISUALIZATION),
    ("share_visualization", {"queryId": 7, "visualizationId": 31, "action": "revoke"}, "revoke", VISUALIZATION),
]

REFUSED_ANSWERS = [
    ("fork_query", {"queryId": 7}, check("archive", QUERY)),
    ("fork_query", {"queryId": 8}, check("fork", QUERY)),
    ("fork_query", {"queryId": 7}, check("fork", DASHBOARD)),
    ("archive_query", {"queryId": 7, "restore": True}, check("archive", QUERY)),
    ("archive_query", {"queryId": 7, "restore": False}, check("restore", QUERY)),
    ("archive_dashboard", {"dashboardId": 4, "restore": False}, check("archive", DASHBOARD)),
    ("archive_dashboard", {"dashboardId": 3, "restore": False}, check("archive", QUERY)),
    ("set_favorite", {"kind": "query", "id": 7, "favorite": True}, check("unfavorite", QUERY)),
    ("set_favorite", {"kind": "query", "id": 3, "favorite": True}, check("favorite", DASHBOARD)),
    ("share_dashboard", {"dashboardId": 3, "action": "create"}, check("revoke", DASHBOARD)),
    (
        "share_visualization",
        {"queryId": 7, "visualizationId": 32, "action": "create"},
        check("share", VISUALIZATION),
    ),
    (
        "share_visualization",
        {"queryId": 8, "visualizationId": 31, "action": "create"},
        check("share", VISUALIZATION),
    ),
    (
        "share_visualization",
        {"queryId": 7, "visualizationId": 31, "action": "create"},
        check("share", {"kind": "visualization", "id": 31, "name": "Chart"}),
    ),
]
