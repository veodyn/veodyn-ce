---
sidebar_position: 14
title: Profile & Preferences
description: "Your account page: identity, API key, password, group membership, and the theme preference."
---

# Profile & Preferences

## Your profile

**Profile** (in the sidebar footer) is your account page. `/users/me` is an alias for it and redirects there, so both addresses land in the same place.

It reads top to bottom as identity, then access, then what you own:

- **Identity**: your avatar, name, when you joined, and when you were last active.
- **Account**: your **name** and **email**, editable, with **Save** unavailable until something changes. The form says why the email matters: it is how you sign in, so changing it changes your sign-in address.
- **Security**: your personal **API key** and **Change Password**.
- **Groups**: the groups you belong to, read-only here. Admins manage membership under [Team](/admin/users).
- **Your queries**, and the other objects you own.

Groups sit directly under Security rather than at the foot of the page, so what your account may reach sits beside the key and the password.

### Your API key

The key is shown masked, with controls to reveal it, copy it, and regenerate it behind a confirmation. It is your own key, so nobody has to grant you permission to rotate it.

It authenticates [MCP clients](/features/connect#mcp) and [programmatic API access](/features/connect#apis) as you, and reaches exactly what your account can. Regenerate it if it ever leaks: anything using the old key stops working immediately.

### If the page will not load

Signed out, it says there is no profile to show. If the account cannot be read, it says so and suggests reloading, noting that a session may have expired, rather than presenting a blank form that would silently save nothing.

## Theme

The **Theme** menu in the sidebar footer switches between Light, Dark, and System. A handful of surfaces force their own theme regardless: print views are always light, and the [enterprise](/editions) presentation and wall modes are always dark.

Organization-wide settings (authentication methods, feature flags, date formats) are an admin surface: see [System Administration](/admin/system#settings).
