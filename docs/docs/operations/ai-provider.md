---
sidebar_position: 2
title: AI Provider
description: "Configuring the AI provider: the relay contract, the shared bearer key, the Anthropic model key, and the operational gotchas."
---

# AI Provider

Veodyn's [AI features](/features/ai) are powered by a provider: a service implementing a small HTTP contract the frontend relays to. The veodyn-api sidecar ships that provider under its `/ai` prefix, backed by Anthropic Claude; setting `ai.enabled` in the instance config is a statement that an operator has supplied one.

## The contract

| Route | Answers | Edition |
|---|---|---|
| `POST /ai/generate-sql` | Draft SQL plus a rationale | Community |
| `/ai/chat/*` | The data chat: threads, turns, streamed replies, tool results and the MCP calls | Community |
| `POST /ai/outline` | A report outline whose sections cite real query IDs or none | [Enterprise](/editions) |
| `POST /ai/report` | Draft report blocks, every data block carrying a real query ID | Enterprise |
| `GET /ai/digest` | Digest items, each citing a real query or KPI | Enterprise |
| `POST /ai/suggest-annotations` | Annotation drafts that pass the manual form's own validation | Enterprise |

A community build serves the first two rows and answers 404 on the rest, which is
the quickest way to tell the editions apart from outside.

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
VEODYN_AI__TOKEN_SECRET=<signs the data chat's user token>
```

The data chat is on wherever `ai.enabled` is. Without the token secret on both sides the chat answers 503 "The data chat is not configured" while SQL generation keeps working.

Provider (veodyn-api):

```bash
VEODYN_AI_RELAY_KEY=<the same shared bearer>
VEODYN_AI_API_KEY=<your Anthropic API key>
VEODYN_AI_MODEL=claude-sonnet-5        # the default
VEODYN_AI_TOKEN_SECRET=<the frontend's token secret>
```

Only the release serving HTTP needs the model key, since nothing that runs in the background generates.

## Authorization model

The relay authenticates the caller's session, then strips the cookie before calling out (the provider may be a third party), replacing it with the shared bearer: frontend `VEODYN_AI__KEY` must equal provider `VEODYN_AI_RELAY_KEY`. If either the bearer or the model key is unset, every `/ai` route answers 503, so a half-configured deployment refuses rather than becoming an open generation endpoint.

SQL generation profiles the table it is asked about on the service account, so the configured provider sees a sample of that table (the most common values of each text column, the range of each numeric or time one). The data chat is different: it reads the library under the signed-in user's own session, so it can only name what that user can open.

## Operational notes

- The model key is the one secret to treat specially. It is attached to spend, so the reference deployment keeps it out of the committed secrets file and sets it directly on the cluster. If your pipeline rebuilds the shared Secret from a file, a deploy will replace the live key with the placeholder and AI starts answering 503; re-apply it after such deploys, or source the Secret from a secret manager.
- Do not set a temperature unless you know your model accepts it. Current Claude models refuse requests carrying the parameter, so `VEODYN_AI_TEMPERATURE` stays unset by default and the parameter is only sent when configured.
- Provider failures are logged server-side (with the key scrubbed) as `provider returned ...`. The browser never receives provider error bodies, so the pod log is where to look.
- Known limits: there is no per-user rate limit on the shared bearer, and the session check is what keeps anonymous callers out. On an enterprise build, the digest is additionally cached in-process per pod (replicas can briefly disagree), and annotation suggestions read cached results only, so a dashboard that has not been opened recently yields an empty list rather than triggering query runs.
