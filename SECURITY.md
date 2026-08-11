# Security Policy

> ## STOP: this policy has no contact yet
>
> The contact below is the literal string
> `<<< SECURITY CONTACT NOT SET >>>`. It is a placeholder, not an address.
> Nothing sent to it reaches anyone, and while it is there this file cannot
> receive a report.
>
> Whoever publishes this repository chooses the contact and replaces that
> string first. Anyone reading this in a public repository: the placeholder
> shipped by mistake, and the fastest way to reach the maintainers is to say
> so in a public issue **without describing the vulnerability**.

## Supported versions

There is no numbered release yet. The current default branch is the only
supported version, and fixes land there.

| Version | Supported |
|---|---|
| Default branch | Yes |
| Container images built from any earlier commit | No |

If you are running an image built from an older commit, the upgrade path is
the default branch. Nothing is backported, because there is nothing to
backport to.

## Reporting a vulnerability

Report privately. Do not open an issue, a pull request or a discussion for a
suspected vulnerability: all three are world readable from the moment they are
created, which is the wrong place to describe a hole that is not fixed yet.

**Contact:** `<<< SECURITY CONTACT NOT SET >>>`

A report is easiest to act on when it says:

- which tree the problem is in (`app/`, `api/`, `node/`, `helm/`, the compose
  stack), and the commit you saw it on
- what an attacker gets out of it, concretely, and what they need first
  (an account, a session, a particular group membership, network reach)
- the steps to reproduce it, ideally against the local stack in
  [`compose.yaml`](compose.yaml) so we are looking at the same thing
- anything you already know about the fix

Please do not run tests against a deployment you do not own.

You will get an acknowledgement, and updates as the fix moves. We will tell
you when a fix has landed and what it was, and we will credit you by whatever
name you want in the notes for the change, or not at all if you would rather.

## What is in scope

This repository is three codebases and the configuration that deploys them:

- `app/`, the Next.js frontend, including the server side proxy routes under
  `app/src/app/api/*` that hold every backend credential
- `api/`, the FastAPI sidecar
- `node/`, the query service, backend only
- `helm/`, `ci/`, `compose.yaml` and `scripts/`, as configuration

Authentication and per user permissions are the query service's throughout, and
the frontend's rule is that the browser never talks to a backend directly. A
way to make either of those untrue is the kind of report this policy most
wants: a route that reaches a backend with something other than the caller's
own credential, a path that returns data the caller's groups do not allow, or
anything that gets a backend URL or an API key into a browser.

`node/` is not an exception to any of that. It is maintained here like the rest
of the tree, so a problem in the query service is reported here, the same way
and to the same contact.

## What is not a vulnerability here

The root [`compose.yaml`](compose.yaml) is a local stack for evaluating and
developing the product. It publishes service ports on all interfaces, runs
PostgreSQL with trust authentication inside its own network (no host port, so
it is reachable only from the stack), generates its secrets on first boot, and
prints a generated admin password once to a container log. Those are
deliberate, documented choices for a local stack. Reports that it is not
hardened for production are welcome as documentation issues rather than as
vulnerabilities. See
[Deployment](docs/docs/operations/deployment.md) for how a real install is
meant to handle secrets.

Reports produced by a scanner with no working exploit path, and findings in a
dependency that this repository does not reach, are usually better filed as
ordinary issues.

## Committing credentials

Never commit a credential, including in a fixture, a test, a plan document or
a comment. Two guards run in CI and both are worth running locally before you
push:

```bash
python3 scripts/scan-secrets.py        # credential shaped literals, whole tree
python3 scripts/check-public-tree.py   # paths that must not be public
```

If a credential does land in a commit, treat it as disclosed and rotate it.
Removing it in a later commit does not remove it from the history.
