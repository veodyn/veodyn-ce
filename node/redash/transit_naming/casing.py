import re

LOWERCASE_WORDS = frozenset(
    {"de", "del", "la", "las", "los", "el", "and", "or", "at", "of", "the", "on", "in", "to", "via", "near", "between"}
)
UPPERCASE_PART_BOUNDARY = re.compile(r"[/&\\\-(]")
MIXED_CASE_PART_BOUNDARY = re.compile(r"[/&\\(]")
TOKEN = re.compile(r"[A-Za-z0-9']+|[^A-Za-z0-9']+")
ORDINAL = re.compile(r"^(\d+)(st|nd|rd|th)$", re.IGNORECASE)
MC_NAME = re.compile(r"^mc[a-z]{2,}$", re.IGNORECASE)


def _from_uppercase(word, leads_part, keep_upper):
    if word.upper() in keep_upper or (len(word) == 1 and word.isalpha()):
        return word.upper()
    ordinal = ORDINAL.match(word)
    if ordinal:
        return ordinal.group(1) + ordinal.group(2).lower()
    lower = word.lower()
    if not leads_part and lower in LOWERCASE_WORDS:
        return lower
    if MC_NAME.match(word):
        return "Mc" + lower[2].upper() + lower[3:]
    return lower[:1].upper() + lower[1:]


def _from_mixed_case(word, leads_part):
    if word[:1].islower() and (leads_part or word.lower() not in LOWERCASE_WORDS):
        return word[:1].upper() + word[1:]
    return word


def is_uppercase(text):
    return bool(text) and any(char.isalpha() for char in text) and not any(char.islower() for char in text)


def recase(text, keep_upper=frozenset(), uppercase=None):
    if not text or not any(char.isalpha() for char in text):
        return text
    if uppercase is None:
        uppercase = is_uppercase(text)
    boundary = UPPERCASE_PART_BOUNDARY if uppercase else MIXED_CASE_PART_BOUNDARY
    leads_part = True
    out = []
    for token in TOKEN.findall(text):
        if not token[:1].isalnum() and token[:1] != "'":
            out.append(token)
            leads_part = leads_part or bool(boundary.search(token))
            continue
        out.append(
            _from_uppercase(token, leads_part, keep_upper) if uppercase else _from_mixed_case(token, leads_part)
        )
        leads_part = False
    return "".join(out)
