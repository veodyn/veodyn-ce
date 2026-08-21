---
sidebar_position: 12
title: Sharing & Embeds
description: "Everything reachable without signing in: public dashboards, embedded visualizations, query API keys, enterprise public reports, and how tokens are governed and revoked."
---

# Sharing & Embeds

A handful of surfaces are reachable without an account. Each one is an unlisted token URL, and every link can be revoked at its source.

## The public surfaces

| Surface | URL shape | What an anonymous visitor sees | Edition |
|---|---|---|---|
| Public dashboard | `/dashboards/public/<token>` | The dashboard's widgets, read-only | Community |
| Public visualization | `/embed/public/<token>` | One visualization and its latest result, sized for an iframe | Community |
| Public report | `/reports/public/<token>` | The frozen, approved snapshot (never later edits), with `noindex` | [Enterprise](/editions) |

Tokens work as lookup keys rather than as secrets embedded in the page: every refusal renders a neutral page that does not echo the token, so a screenshot of a failure cannot leak a working link.

### One answer for every refusal (enterprise) {#one-answer-for-every-refusal}

:::info An enterprise feature

Public report links are part of the [enterprise edition](/editions), so a
community build never mints one and never serves this page. Public dashboards
and embeds, above, are community.

:::

A public report link that does not resolve shows exactly this, whatever the reason:

> **This report is no longer available.**
> The link may have been revoked.

The same page appears for an unknown token, a revoked one, a report pulled back to draft, one that was never published or never snapshotted, and an upstream failure. The browser tab reads only *Shared report*, so neither the page nor its title reveals which report was behind the link, or whether one ever was.

Because the answer is uniform, a recipient who is refused learns nothing about your instance, and someone probing tokens cannot tell a wrong guess from a revoked link.

These pages need no sign-in, run no queries, and render the frozen snapshot alone, which is why a revoked link fails cleanly rather than through an error page.

### What each public surface actually shows

A public dashboard drops the sidebar and every app control, leaving the dashboard's title and its widget grid. Each widget keeps its data age, a **Refresh** and an **Expand** control, and tables keep their own search and row count, so a recipient can work with the data without an account.

A public visualization is stripped further still: one visualization, its data, and nothing else. There are no links and no buttons, and the browser tab reads only *Shared visualization*, so neither the page nor its title names the query behind it. That is what makes it safe to drop into someone else's page in an iframe.

:::note Widgets on a public dashboard link to queries you cannot open

Each widget on a public dashboard also carries an **Open query** control pointing into the authenticated application. If you are reading a shared dashboard without an account, that control leads to a sign-in page rather than the query, while the rest of the widget's controls work normally.

:::

### A second embed URL exists, and it is not the public one

`/embed/query/<queryId>/visualization/<vizId>` also renders a single visualization, but it authenticates from the reader's own session. It is the address embeds used before per-visualization tokens existed, and the **Embed** dialog no longer offers it.

If you have an old iframe snippet pointing there, it will not work for anyone outside the instance: signed in it renders normally, signed out it sits on *Loading...* indefinitely rather than reporting that it cannot authenticate. Re-mint the snippet from the Embed dialog to get a `/embed/public/<token>` URL.

Older snippets still appended the author's email address as an `api_key` parameter, which published a real person's address into the markup and referrer logs of every site they were pasted into, and which the page never even read. Any snippet containing `api_key=` should be replaced rather than edited.

## The share dialog

**Share** on a dashboard opens a dialog with a single **Public Access** switch and one sentence: *anyone with the link can view this dashboard.*

Opening the dialog does nothing on its own. The switch is what mints or revokes, so you can look without publishing.

While sharing is off, an **expiry** field lets you decide how long the link should last, and says that leaving it empty produces one that stays open until sharing is turned off. Once a link exists the field is gone, because the expiry was fixed when the link was minted and a field that silently changed nothing would be worse than no field. To change it, revoke and mint again.

With sharing on, the dialog shows the **Public URL** with a copy control, plus a warning: parameters with text values are disabled in the shared version, so a dashboard that relies on a text parameter will not behave for a recipient the way it does for you.

### When the switch is unavailable

There are two reasons, and each is stated in its own words rather than through one vague sentence:

- You may not publish. *An administrator can grant publish_dashboard to your group.* The backend enforces the same rule on the mint, so the refusal here matches what a mint attempt would return.
- There is no connected backend, in which case a link would resolve to an empty page.

## How links are minted

- **Dashboards**: the Share dialog's Public Access toggle. See [Dashboards](/features/dashboards#sharing).
- **Visualizations**: the query menu's **Embed** action (available on queries marked safe for embedding) provides the public URL and an iframe snippet with width and height.
- **Reports** ([enterprise](/editions)): publishing mints the link, with an optional expiry; unpublish and revoke are separate actions. See [Reports](/features/reports#review-and-publishing).

## Query API keys

Each query has an API key for fetching its results programmatically (the basis of the [Connect / APIs](/features/connect) page examples). The key is revealed and copied from the query's **API Key** dialog, and can be regenerated with a confirmation, which immediately invalidates the old URL.

## Governance

- The org-wide **Disable Public URLs** feature flag (in Settings) switches the whole mechanism off.
- Because each backend serves its own tokens, revocation applies at the source: a revoked link dies everywhere at once. A dashboard's link is revoked from its own Share dialog, and an embed's from the query's Embed dialog.
- **Admin → Shared Links** ([enterprise](/editions)) lists every dashboard, embed and report reachable without signing in, filterable by Reachable / All / Expired, searchable, with bulk revoke. See [System Administration](/admin/system). A community build has no such inventory: each link is governed where it was minted.
