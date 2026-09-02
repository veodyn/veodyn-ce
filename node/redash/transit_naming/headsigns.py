import re

HYPHEN = re.compile(r"\s*-\s*")
WHITESPACE = re.compile(r"\s+")


def _title(token):
    if token.isupper() and len(token) <= 2:
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
        bare = token.rstrip(".")
        if bare.lower() in lookup:
            words.append(lookup[bare.lower()])
        elif rules.title_case:
            words.append(_title(bare) if token != "-" else "-")
        else:
            words.append(bare)
    return WHITESPACE.sub(" ", " ".join(words)).strip().rstrip(".")
