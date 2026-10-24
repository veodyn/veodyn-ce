import json


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return str(json.loads(value))
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def split_frontmatter(text: str) -> tuple[dict[str, str], list[str]]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, lines
    for end, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            fields: dict[str, str] = {}
            last_key = ""
            for entry in lines[1:end]:
                item = entry.strip()
                if entry.startswith((" ", "\t")) and item.startswith("- ") and last_key:
                    joined = fields[last_key]
                    fields[last_key] = f"{joined},{item[2:].strip()}" if joined else item[2:].strip()
                    continue
                key, colon, value = entry.partition(":")
                if colon and key.strip() and not key.startswith((" ", "\t")):
                    last_key = key.strip()
                    fields[last_key] = unquote(value)
            return fields, lines[end + 1 :]
    return {}, lines


def flow_list(value: str) -> set[str]:
    inner = value.strip().removeprefix("[").removesuffix("]")
    return {unquote(one) for one in inner.split(",") if one.strip()}
