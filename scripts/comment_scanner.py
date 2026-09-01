import ast
import io
import tokenize

HASH_EXTENSIONS = {
    ".py",
    ".pyi",
    ".sh",
    ".bash",
    ".zsh",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".tf",
    ".hcl",
    ".rb",
}
SLASH_EXTENSIONS = {
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".c",
    ".h",
    ".cc",
    ".cpp",
    ".swift",
    ".scss",
    ".less",
}
BLOCK_ONLY_EXTENSIONS = {".css"}
DASH_EXTENSIONS = {".sql", ".lua"}
HASH_FILENAMES = {"Dockerfile", "Makefile", "Justfile", "Procfile"}
SUPPORTED_EXTENSIONS = (
    HASH_EXTENSIONS | SLASH_EXTENSIONS | BLOCK_ONLY_EXTENSIONS | DASH_EXTENSIONS
)
QUOTES = ("'", '"')
REGEX_PRECEDERS = set("=(,:[!&|?{};+-*%<>~^")


def supports(path):
    name = path.rsplit("/", 1)[-1]
    if name in HASH_FILENAMES or name.startswith("Dockerfile."):
        return True
    dot = name.rfind(".")
    return dot > 0 and name[dot:].lower() in SUPPORTED_EXTENSIONS


def extension_of(path):
    name = path.rsplit("/", 1)[-1]
    if name in HASH_FILENAMES or name.startswith("Dockerfile."):
        return ".sh"
    dot = name.rfind(".")
    return name[dot:].lower() if dot > 0 else ""


def count(path, text):
    extension = extension_of(path)
    if extension in (".py", ".pyi"):
        return count_python(text)
    if extension in SLASH_EXTENSIONS:
        return count_curly(text, line_token="//", block=True)
    if extension in BLOCK_ONLY_EXTENSIONS:
        return count_curly(text, line_token=None, block=True)
    if extension in DASH_EXTENSIONS:
        return count_curly(text, line_token="--", block=True)
    if extension in HASH_EXTENSIONS:
        return count_hash(text)
    return 0


def count_python(text):
    lines = set()
    try:
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type != tokenize.COMMENT:
                continue
            if token.start[0] == 1 and token.string.startswith("#!"):
                continue
            lines.add(token.start[0])
    except (tokenize.TokenError, IndentationError, SyntaxError, ValueError):
        return count_python_by_prefix(text)
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return len(lines)
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if not isinstance(first, ast.Expr) or not isinstance(first.value, ast.Constant):
            continue
        if not isinstance(first.value.value, str):
            continue
        end = getattr(first, "end_lineno", first.lineno) or first.lineno
        lines.update(range(first.lineno, end + 1))
    return len(lines)


def count_python_by_prefix(text):
    total = 0
    for line in text.splitlines():
        if line.lstrip().startswith("#") and not line.lstrip().startswith("#!"):
            total += 1
    return total


def count_hash(text):
    lines = set()
    line_number = 1
    quote = None
    previous = ""
    for index, char in enumerate(text):
        if char == "\n":
            line_number += 1
            quote = None
            previous = ""
            continue
        if quote:
            if char == quote and previous != "\\":
                quote = None
        elif char in QUOTES:
            quote = char
        elif char == "#":
            if index == 0 or previous in ("", " ", "\t"):
                if not text.startswith("#!", index) or line_number > 1:
                    lines.add(line_number)
        previous = char
    return len(lines)


def count_curly(text, line_token, block):
    lines = set()
    line_number = 1
    index = 0
    length = len(text)
    quote = None
    in_block = False
    in_regex = False
    last_significant = ""
    while index < length:
        char = text[index]
        if char == "\n":
            line_number += 1
            index += 1
            if quote in ("'", '"'):
                quote = None
            in_regex = False
            continue
        if in_block:
            lines.add(line_number)
            if text.startswith("*/", index):
                in_block = False
                index += 2
                continue
            index += 1
            continue
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if in_regex:
            if char == "\\":
                index += 2
                continue
            if char == "/":
                in_regex = False
            index += 1
            continue
        if char in QUOTES or char == "`":
            quote = char
            index += 1
            continue
        if line_token and text.startswith(line_token, index):
            lines.add(line_number)
            while index < length and text[index] != "\n":
                index += 1
            continue
        if block and text.startswith("/*", index):
            in_block = True
            lines.add(line_number)
            index += 2
            continue
        if char == "/" and line_token == "//" and last_significant in REGEX_PRECEDERS:
            in_regex = True
            index += 1
            continue
        if not char.isspace():
            last_significant = char
        index += 1
    return len(lines)
