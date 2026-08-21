---
sidebar_position: 5
title: Dashboards
description: "Building and watching dashboards: the widget grid, refresh rates, parameters, annotations, public sharing, and the enterprise presentation and wall modes."
---

# Dashboards

Dashboards arrange query results on a grid, built for watching rather than authoring. They live in **Library → Dashboards**.

## The dashboard list

The same four tabs as [Queries](/features/queries#the-four-tabs), behaving the same way: **All Dashboards / My Dashboards / Favorites / Archive**, each a real link so tabs are bookmarkable and the back button steps between them.

The Archive tab matters more here than elsewhere, because an archived dashboard appears in no other listing. This tab is the only route back to one.

![The dashboard list: four tabs, a search box and a row per dashboard](/img/screenshots/dashboards-list.png)

Each row shows a star, the name with its tags, who created it, and when. Name, Created By and Created At all sort, over the whole library rather than the visible page, and lists break at 25 rows.

The row menu offers **Archive**, or **Restore** on the Archive tab, and appears only if you may modify that dashboard. Archiving asks first: it takes the dashboard out of your lists and stops any public link to it working, though you can restore it from the Archive tab.

**New Dashboard** asks only for a name and drops you straight into the empty dashboard to add widgets. **Create with AI** appears alongside it when [AI](/features/ai) is enabled.

:::caution Search only narrows the All tab

As on [Queries](/features/queries#searching-and-counting), the search box filters **All Dashboards** only. On My Dashboards, Favorites and Archive it accepts what you type and the list does not change, while the count beside it keeps reporting the unfiltered total. Treat those three as complete lists you sort and page rather than search.

:::

## Viewing a dashboard

The header carries the dashboard's editable name, star, tags, and a **Refresh** rate picker (Never, 1 minute, 5, 10, 30 minutes, 1, 12, or 24 hours) that keeps every widget current while the page is open. The rate belongs to your open page rather than to the dashboard, so nothing keeps refreshing once you close the tab.

![A dashboard in view mode with charts, a counter, and a text box](/img/screenshots/dashboard-view.png)

If widgets declare mapped parameters, a dashboard-level **parameters bar** appears, driving all mapped widgets at once. It is hidden while you are editing, since a control that re-runs every widget is noise when you are moving them around.

Each widget's chrome shows how old its data is, then offers **Refresh**, **Expand** (full-size view), **Annotate**, **Edit visualization**, **Open query**, and **Remove widget** (the last three only in the right modes and permissions).

:::caution The green tick beside a widget's age is not a freshness check

It is drawn on every widget that has data, in the same green the rest of the product uses to mean **Fresh**. A widget refreshed an hour ago and one six days stale look identical, so read the age beside the tick and ignore the colour. Real fresh-versus-stale thresholding exists in the [catalog](/features/data-catalog#reading-the-freshness-badge) and on [Captures](/features/captures), but it has not reached dashboard widgets.

:::

Header actions:

- **Edit**: switches the page into editing, where the header swaps to **+ Widget**, **Textbox**, **Edit with AI** and **Done Editing**.
- **Share**: opens the [sharing dialog](/features/sharing), which mints or revokes the public link.
- The overflow menu holds **Archive**, which returns you to the dashboard list rather than leaving you on a page that no longer resolves.
- **Present** ([enterprise](/editions)): opens [presentation mode](#presentation-mode).
- **Promote to report** ([enterprise](/editions)): copies each widget's query and visualization into a new [report](/features/reports) draft and opens the block editor. It copies rather than links: the new report carries nothing pointing back here, so the two drift apart from that moment on.

## Editing

Edit mode makes widgets draggable and resizable; the layout persists as you arrange it. The toolbar offers:

- **Widget**: add a visualization. Pick a query, pick one of its visualizations, then map any parameters it takes: to a widget-level control, a new dashboard-level parameter, a static value, or a keyword.
- **Textbox**: freeform markdown with a live preview, for headings and commentary between charts.
- **Edit with AI** (when AI is on): describe a change and review the proposed diff as added / removed / redrawn panels before applying. See [AI Features](/features/ai).
- **Done Editing**.

## Annotations

The **Annotate** action opens the annotations dialog: add a label with a time window, applied to all widgets or a single one, and manage the existing list. Annotation times are UTC, matching the chart axis. On an [enterprise](/editions) build with AI enabled, **Suggest annotations** proposes drafts from outliers found in the actual series; each is reviewed and accepted individually, and an accepted draft passes the same validation as a manually created one.

## Sharing

The **Share Dashboard** dialog has one switch: **Public Access**. On, it mints an unlisted URL anyone can view without signing in; off, the link stops working. Public dashboard pages render the widgets read-only. An organization can disable public URLs entirely with a feature flag in [Settings](/admin/system#settings), and on an [enterprise](/editions) build admins can also audit and bulk-revoke every live link at **Admin → Shared Links**.

Revoked or unknown links get a neutral "This dashboard is not available" page that never echoes the token.

## Presentation mode (enterprise) {#presentation-mode}

:::info An enterprise feature

Presentation mode and [wall mode](#wall-mode) below are part of the
[enterprise edition](/editions). They share one component and moved together, so
a community build has neither route.

:::

`/present/<id>` turns a dashboard into a full-screen deck: one widget per slide, with no sidebar or page chrome, and the browser asked to go fullscreen where it will allow it.

It is driven entirely by the keyboard. **Right arrow** and **left arrow** move between slides, **Escape** returns you to the dashboard. Nothing advances on a timer, so a slide stays up until you move it. A counter in the bottom-right corner shows your position, and each slide carries the widget's title, its presenter notes, and how old its data is.

A dashboard whose widgets are all hidden says so rather than presenting an empty deck.

:::caution Slide order is not the dashboard's order

The deck does not follow the arrangement you see on the dashboard. It plays widgets in the order the server returns them, roughly the order they were created, so a dashboard laid out to read top-left to bottom-right can present in a different sequence entirely. Step through the deck once before presenting it to anyone.

:::

![Presentation mode: one widget per slide on a dark full-screen deck](/img/screenshots/present-mode.png)

## Wall mode (enterprise) {#wall-mode}

`/wall` is an unattended, chrome-free display for a lobby or operations-room screen. Unlike [Present](#presentation-mode), it takes no keyboard input and shows one dashboard chosen by the operator rather than whichever one you opened.

Which dashboard is fixed in the instance config as `wall_mode.default_dashboard`. Until that is set, the page says **Wall mode is not configured** and names the setting to change, rather than showing an empty screen with no explanation on it.

![Wall mode: one widget filling a dark screen, its title and data age above and a slide counter below](/img/screenshots/wall.png)

Once configured it runs on two timers: each widget holds the screen for **15 seconds**, and the data behind every widget refreshes every **60 seconds**. A counter in the corner shows the position in the rotation. Where the viewer's system asks for reduced motion, the slide transition is dropped.

### What it does when the data stops

The wall keeps showing the **last known values** and puts an honest banner above them:

> Live data unavailable. Showing last known values.

It also stops refreshing while the connection is down. A refresh attempted during an outage would come back empty and *replace* the good values on screen with nothing, so the wall holds the numbers it already has and lets the banner do the explaining.

Widget order has the same caveat as [presentation mode](#presentation-mode): the rotation follows the order the server returns widgets in, not the way the dashboard is arranged.
