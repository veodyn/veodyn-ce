import re

HYPHEN = re.compile(r"\s*-\s*")
WHITESPACE = re.compile(r"\s+")


def _title(token):
    core = token.rstrip(".,")
    if core.isupper() and len(core) <= 2:
        return token
    return token[:1].upper() + token[1:].lower()


def normalize_headsign(sign, rules):
    text = WHITESPACE.sub(" ", (sign or "").strip())
    if not text:
        return ""
    text = HYPHEN.sub(" - ", text)
    for phrase, replacement in rules.expand.items():
        if " " in phrase:
            text = re.sub(re.escape(phrase), replacement, text, flags=re.IGNORECASE)
    lookup = {key.rstrip(".").lower(): value for key, value in rules.expand.items() if " " not in key}
    words = []
    for token in text.split(" "):
        key = token.rstrip(".").lower()
        if key in lookup:
            words.append(lookup[key])
        elif rules.title_case:
            words.append(_title(token) if token != "-" else "-")
        else:
            words.append(token)
    return WHITESPACE.sub(" ", " ".join(words)).strip().rstrip(".")
