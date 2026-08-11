"""What the model is told about the data source each query reads.

The gap this closes was knowledge, not plumbing. Nothing in the Create-with-AI
prompt mentioned data sources at all: the query list carried an id, a name, tags
and a description, and the rules said nothing about where a query runs. So a
model asked whether one dashboard can draw on several sources answered from its
own priors about Redash rather than from this instance, and the honest answer
was already yes: a data source belongs to the QUERY (`Query.data_source_id`),
and a dashboard has no data source column at all. A widget resolves its source
through the query behind it, so mixing them needs nothing special.

This module was two halves, the lookup and the paragraph, kept together on the
argument that the second is only true while the first is supplied. That held
while the AI was the only reader. Feed Health now needs the same map to name the
system a capture runs against, so the lookup moved to
services/redash_lookups.py and the prose stayed here, which is what a module
named after a prompt rule should hold. The dependency the old docstring worried
about is now the caller's to keep, and it is one line away from the rules: the
code that appends these is the code that passes `sources` into list_queries.

A separate module rather than more of ai_converse_prompt.py, following
ai_capture_semantics.py: a block of prompt prose is its own thing, and the
prompt file is already the longest thing a person argues about.
"""

# Appended beside the query list, and only when there is one. It is a rule about
# the rows in that list, exactly as CAPTURE_SEMANTICS is a rule about the rows in
# the catalog, and it is noise to a kind that was given no queries.
DATA_SOURCE_RULES = (
    "Each query above carries `reads`: the data source it runs against. A data source belongs to the "
    "QUERY, never to the dashboard or the report: a widget takes its source from the query behind it, "
    "so one dashboard can hold widgets reading different systems side by side and that is ordinary, "
    "not a problem to warn the analyst about. Never say a dashboard has to stay on one data source, "
    "and never leave a query out because it reads a different one from the others. "
    "A NEW query you specify is written against the catalog tables and is created on the single data "
    "source the analyst picks on the proposal card, so do not offer to write one query against one "
    "source and another against a different one, and do not offer a query that joins two sources: "
    "each one you write reads the tables listed above."
)
