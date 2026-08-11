---
sidebar_position: 2
title: AI Provider
description: "Configuring the AI provider: the relay contract, the shared bearer key, the Anthropic model key, and the operational gotchas."
---

# AI Provider

Veodyn's [AI features](/features/ai) are powered by a **provider**: a service implementing a small HTTP contract the frontend relays to. The veodyn-api sidecar ships that provider under its `/ai` prefix, backed by Anthropic Claude; setting `ai.enabled` in the instance config is a statement that an operator has supplied one.

## The contract

| Route | Answers | Edition |
|---|---|---|
| `POST /ai/generate-sql` | Draft SQL plus a rationale | Community |
| `POST /ai/converse` | The next turn of a creation chat, and a proposal once ready | Community |
| `POST /ai/outline` | A report outline whose sections cite real query IDs or none | [Enterprise](/editions) |
| `POST /ai/report` | Draft report blocks, every data block carrying a real query ID | Enterprise |
| `GET /ai/digest` | Digest items, each citing a real query or KPI | Enterprise |
| `POST /ai/suggest-annotations` | Annotation drafts that pass the manual form's own validation | Enterprise |

A community build serves the first two and answers 404 on the rest, which is
also the quickest way to tell the two editions apart from the outside.

The frontend validates every response again on arrival and refuses anything malformed, so provider drift surfaces as "AI is broken" rather than as silently wrong data.

## Configuration

Frontend (the relay):

```yaml
# veodyn.config.yaml (or VEODYN_AI__* env vars)
ai:
  enabled: true
  endpoint: http://veodyn-api-api:8000/ai
```

```bash
# environment only, never YAML
VEODYN_AI__KEY=<shared bearer>
```

Provider (veodyn-api):

```bash
VEODYN_AI_RELAY_KEY=<the same shared bearer>
VEODYN_AI_API_KEY=<your Anthropic API key>
VEODYN_AI_MODEL=claude-sonnet-5        # the default
```

Only the release serving HTTP needs the model key. Nothing that runs in the background generates.

## Authorization model

The relay authenticates the caller's session, then **strips the cookie** before calling out (the provider may be a third party), replacing it with the shared bearer: frontend `VEODYN_AI__KEY` must equal provider `VEODYN_AI_RELAY_KEY`. If either the bearer or the model key is unset, every `/ai` route answers **503**: a half-configured deployment refuses rather than becoming an open generation endpoint.

Grounding runs as the service account, so a suggestion can name a query the reader cannot open, but never show its contents; result reads still go through the query service under the reader's own credential.

## Operational notes

- **The model key is the one secret to treat specially.** It is attached to spend, so the reference deployment keeps it out of the committed secrets file and sets it directly on the cluster. If your pipeline rebuilds the shared Secret from a file, a deploy will replace the live key with the placeholder and AI starts answering 503; re-apply it after such deploys, or source the Secret from a secret manager.
- **Do not set a temperature** unless you know your model accepts it: current Claude models refuse requests carrying the parameter, so `VEODYN_AI_TEMPERATURE` stays unset by default and the parameter is only sent when configured.
- **Provider failures are logged server-side** (with the key scrubbed) as `provider returned ...`; the browser never receives provider error bodies, so the pod log is where to look.
- **Known limits**: there is no per-user rate limit on the shared bearer (the session check is what keeps anonymous callers out). On an enterprise build, the digest is additionally cached in-process per pod (replicas can briefly disagree), and annotation suggestions read cached results only, so a dashboard nobody has opened recently yields an empty list rather than triggering query runs.
