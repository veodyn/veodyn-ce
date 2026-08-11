# Data source logos

Served directly by Next at `/db-logos/<type>.png`, where `<type>` is a query
runner's `type()` string. `DataSourceLogo` builds that path; there is no route
handler and no proxy.

These were vendored out of the node's React client when that client was
deleted. They used to reach the product through a proxy that fetched
`/static/images/db-logos/<type>.png` from the node, which only worked because a
webpack build copied them there. Nothing builds that any more.

## Why some files are named `riits_*`

A data source row stores its runner's `type()` string, and nine runners were
renamed off that customer prefix. The old strings stay resolvable as deprecated
aliases so existing rows keep working until an operator migrates them, and a
row rendering under its old type asks for the old filename. Both names are
present on purpose:

    airnow.png            riits_airnow.png
    gbfs.png              riits_gbfs.png
    geotab.png            riits_geotab.png
    go511.png             riits_go511.png
    metrocloudalliance.png  riits_mca.png
    openweathermap.png    riits_openweathermap.png
    socaltransport.png    riits_socaltransport.png
    trafficland.png       riits_trafficland.png
    waze.png              riits_waze.png

**Delete the `riits_*` half of each pair in the same release that deletes the
aliases** from the node's `legacy_types.py`, not before. Deleting them earlier
blanks the logo on every row an operator has not migrated yet, which is exactly
the row that most needs to look like something.

Three more have no renamed partner and are kept for a different reason:

- `riits_gtfsrt.png`, `riits_geojson.png`: these two are not pure renames, so
  they have no alias and an operator has to resolve each row by hand. The logo
  is what makes such a row identifiable in the list.
- `riits_api.png`: that runner moved to a private tenant pack. A deployment
  with the pack installed still renders it.

`riits_nextbus.png` and `riits_twitter.png` were vendored and then removed:
those two runners were deleted outright rather than renamed, so no row can
resolve them and nothing would ever request the file.

## Why there are more PNGs here than manifest entries

`node/tests/query_runner/db_logo_manifest.txt` is the authority on which of
these files are load-bearing, and it lists only the **registered,
non-deprecated** types. A PNG with no manifest entry is therefore not
automatically dead, and grep will not settle it either way, because nothing
here is referenced by name from any source file: the name is built at runtime
from a data source's stored `type` string.

There are 57 PNGs here and 45 manifest entries. **Every one of the twelve
extras is a `riits_*` legacy name**, for the reasons in the section above: the
nine deprecated aliases, the two rows an operator migrates by hand, and the one
runner that moved to a private tenant pack.

That used to be one group of four. The connector curation emptied the other
three, and they are written out here because the reasons they existed are the
reasons a future extra would be legitimate:

- **Deprecated but still registered**, so existing rows still rendered:
  `elasticsearch`, `kibana` and `url`. All three runners are gone, so no row
  can hold those type strings.
- **Registered only when an optional driver is installed**, so absent from the
  registry the manifest is generated against but live in an image that had the
  driver: `db2` and `vertica`. Both runners are gone.
- **Shipped in the tree but not in `default_query_runners`**, reachable through
  `REDASH_ADDITIONAL_QUERY_RUNNERS`: `python` and `bigquery_gce`. Both runners
  are gone. Note that this group can come back without anything being added
  here, because that env var makes the settings list a floor rather than the
  full set; see the section below.

Earlier, `firebolt.png` and `mapd.png` were removed for a fourth reason that no
longer has a group: they had no query runner module behind them under any name,
so no row could hold that type string and the path could never be built. The 45
PNGs the curation removed are a different case entirely. Each had a real runner
behind it until the runner was deleted on purpose. If any of those runners is
restored, restore its logo with it, and if it registers a non-deprecated type,
add that type to the manifest as well.

## What the guard covers, and where it stops

Two tests keep this directory honest, one on each side of a boundary neither
can cross alone:

- `node/tests/query_runner/test_db_logo_assets.py` asserts the live query
  runner registry against `node/tests/query_runner/db_logo_manifest.txt`, in
  both directions: a registered type missing from the manifest fails, and a
  manifest entry that is no longer registered fails.
- `app/src/components/data-sources/db-logo-manifest.test.ts` asserts that every
  manifest entry has a matching PNG here.

**Both are scoped to `settings.default_query_runners`**, the list of runner
modules this repo ships. The first filters registration down to it
(`PRODUCTION_RUNNER_MODULES`), and the second reads only the manifest that
filtering produced. That scope is narrower than the set a running deployment
loads: `node/redash/settings/__init__.py:350` computes `QUERY_RUNNERS` as
`(REDASH_ENABLED_QUERY_RUNNERS + REDASH_ADDITIONAL_QUERY_RUNNERS) -
REDASH_DISABLED_QUERY_RUNNERS`, and the additional list is not bounded by what
ships here. It can name a module that exists only in a package installed into
the image.

So a deployment that installs an external query runner and enables it that way
registers a `type()` string this repo has never seen. `DataSourceLogo`
(`app/src/components/data-sources/data-source-logo.tsx:33`) builds
`/db-logos/<that string>.png` from it like any other, Next serves a 404, the
`onError` handler swaps in the generic database icon, and **both tests above
stay green**. Nothing is broken and nothing reports it; the data source just
renders without its logo.

That gap is deliberate and should stay. Neither guard can enumerate what a
package outside this repository registers, so widening either one means
asserting something unknowable, and a test that fails on the unknowable gets
switched off, taking the part that does work with it.

**If you add a runner through `REDASH_ADDITIONAL_QUERY_RUNNERS`, add its logo
by hand.** Drop a PNG in this directory named exactly the string the runner's
`type()` returns. Do not add it to `db_logo_manifest.txt`: that file is
checked against the in-tree registry in both directions, so an entry for an
out-of-tree type fails the node test as stale. The PNG alone is the whole fix,
because nothing resolves these files by name at build time.
