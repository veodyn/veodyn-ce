"""How to read an append-only capture, said once.

Every table the AI can query is written by node/redash/historical/tasks.py: each
scheduled run re-inserts the source query's WHOLE result set, stamped with one
captured_at per run. So count(*) counts rows times snapshots, and avg(x) over a
whole table is weighted by how often the capture ran. No downstream validator
catches either, which is why the prompt says it.

Its own module because ai_sql.py must not import the interview's prompt module.
"""

CAPTURE_SEMANTICS = """How these tables are written:

Every table is an append-only capture. Each scheduled run of the source query
re-inserts its whole result set, stamped with one `captured_at` per run. So:

- The CURRENT state is the rows at `max(captured_at)`, never the whole table.
- `count(*)` over the whole table counts rows times snapshots. It never counts
  stations, vehicles or incidents.
- `avg(x)` over the whole table is weighted by how often the capture ran, not by
  time. Aggregate within a snapshot, or group by a rounded `captured_at` first.
- A series over history groups by a rounded `captured_at`. One point per period,
  not one point per captured row.

The two statements this makes correct:

    -- the current state
    SELECT * FROM <table> WHERE captured_at = (SELECT max(captured_at) FROM <table>)

    -- a series over history
    SELECT toStartOfHour(captured_at) AS bucket, avg(<measure>) AS value
    FROM <table> GROUP BY bucket ORDER BY bucket"""
