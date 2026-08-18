"""What the model is told about the data source each query reads.

A data source belongs to the QUERY (`Query.data_source_id`); a dashboard has no
data source column, and a widget resolves its source through the query behind it.

Only the prose lives here. The lookup that supplies it is in
services/redash_lookups.py, shared with Feed Health. Whatever appends these rules
is the code that passes `sources` into list_queries.
"""

# Appended beside the query list, and only when there is one: it is a rule about
# the rows in that list, and noise to a kind that was given no queries.
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
