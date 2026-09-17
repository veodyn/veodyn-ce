import re

from veodyn_api.services.connector_contract import ContentContract, Rendering

MARKUP = re.compile(r"<[^<>]+>|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)")
URL_IN_A_BODY = re.compile(r"https?://[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::[0-9]+)?(?:/\S*)?")


def urls_in(text: str) -> tuple[str, ...]:
    return tuple(URL_IN_A_BODY.findall(text))


def counted_length(contract: ContentContract, rendering: Rendering) -> int:
    length = len(rendering.body)
    if contract.url_counts_as_characters is None:
        return length
    for url in rendering.urls:
        if url in rendering.body:
            length += contract.url_counts_as_characters - len(url)
    return length


def contract_violations(contract: ContentContract, rendering: Rendering) -> tuple[str, ...]:
    problems: list[str] = []
    if contract.max_length is not None:
        length = counted_length(contract, rendering)
        if length > contract.max_length:
            problems.append(f"the rendering counts {length} characters against a limit of {contract.max_length}")
    if not contract.supports_markup and MARKUP.search(rendering.body) is not None:
        problems.append("this channel takes plain text and the rendering carries markup")
    footer = contract.required_footer
    if footer is not None and not rendering.body.rstrip().endswith(footer):
        problems.append(f"this channel requires the rendering to end with {footer!r}")
    return tuple(problems)
