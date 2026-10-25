---
sidebar_position: 11
title: AI Features
description: "Create with AI for queries, dashboards and snippets, SQL generation in the editor, and Edit with AI on dashboards."
enterprise_sections:
  - the-digest
  - annotation-suggestions
---

# AI Features

With an [AI provider configured](/operations/ai-provider), Veodyn gains a set of assisted flows. Three rules hold everywhere:

1. With `ai.enabled` false, no AI control renders anywhere, and every flow the AI assists still has a manual path, so switching it off leaves a product that works rather than one with holes in it.
2. The model writes the words and code assigns the IDs. Grounding is assembled server-side from what your instance actually has, and a model's pick is looked up against that same list, so a suggestion can't link to a query that does not exist or mis-cite a source.
3. Generated SQL lands in the editor for you to read, and proposals become objects only when you apply them. Nothing runs or saves on its own.

## Create with AI

A **Create with AI** button sits on the Queries, Dashboards and Query Snippets lists (and in the query editor), and on the KPIs, Reports and Messages lists where those [enterprise](/editions) features are installed. It opens a new thread in the data chat with that object kind as its subject, so the assistant starts out knowing what you want to make. Describe it, answer follow-ups, and when the plan is concrete a proposal card appears in the transcript.

The chat is on wherever AI is. It needs the token secret described in [AI Provider](/operations/ai-provider), and without it the chat answers "The data chat is not configured".

Proposal cards are editable before you apply them, and each kind shows what it is about to make:

- **Query**: name, description, the generated SQL in full, data source, and a visualization.
- **Dashboard**: name and the panel list. Missing queries the AI intends to write are disclosed before creation.
- **Snippet**: trigger, description, and the fragment. A snippet can also be edited or deleted from chat; a delete asks you to confirm.
- **KPI** (enterprise): name, source query, value column, target, unit, direction, cadence. An existing KPI can be edited the same way.
- **Report** (enterprise): an outline with per-section Include checkboxes, each section marked as reusing an existing query or writing a new one. Applying it creates a draft report; publishing still goes through review and approval, with the same separate-approver rule as everywhere else.
- **Message** (enterprise): header and description, applied by opening the message composer prefilled.

### Nothing happens by accident

Nothing is saved as a side effect of talking: an object exists only once you apply its proposal, and the assistant only reads what you could open yourself.

## SQL generation in the editor

The prompt bar above the SQL editor turns a description into draft SQL, placed in the editor with the model's rationale underneath it. It is never executed automatically. After the first draft the bar becomes "Edit with prompt" for iterating. If you hand-edit the buffer while a generation is in flight, your edit wins and the stale draft is discarded.

Where generation cannot work, the bar says why instead of vanishing: a JSON-based data source takes no SQL, a schema entry that is documentation rather than a table cannot be queried, and a provider outage reads "AI is unavailable right now. Write SQL manually below."

### SQL safety

Generated SQL passes the same guardrails as the no-code Visual builder: single statement, SELECT/WITH only, no state-changing keywords, identifiers checked against the live schema, values emitted as escaped literals, and the tables read must belong to the dataset you asked about. A refused generation is retried once with the reason, then handed back to you.

## Edit with AI (dashboards)

**Edit with AI** on a dashboard opens a chat thread about that dashboard. The proposal shows the change as a diff of which panels are being added, removed, or redrawn, so you can see exactly what applying it will do.

## The digest (enterprise) {#the-digest}

:::info An enterprise feature

The digest and the annotation suggestions below are part of the
[enterprise edition](/editions). Their endpoints are absent from a community
build's AI provider, and the Home section and the dialog button that call them
are absent with them. Everything above this line is community.

:::

The Home page's AI digest is a short list of generated claims about your data, each citing the query or KPI it reads via a badge that links straight to it. Candidates arrive carrying their own source IDs and the model only writes the sentence, so a claim that cannot cite a real source is dropped rather than shown. The digest reads cached results only; it never launches query runs on its own.

## Annotation suggestions (enterprise) {#annotation-suggestions}

In the dashboard [annotations dialog](/features/dashboards#annotations), **Suggest annotations** finds outliers in the actual series and proposes labeled drafts with their time windows. Each is accepted individually and passes the same validation as a manual annotation; a draft that fails is refused with the reason.

## Chart authoring

When the AI proposes a chart (in any flow), it also authors the renderer options: column mapping, stacking, axis scale. Those options are sanitized against the same per-type allowlist used for published reports, and core visualization types can infer a sensible column mapping when one is missing, so an AI-authored chart draws and names the columns behind it.

## Privacy and authorization posture

- The browser never talks to a model directly. Every AI request goes through the frontend server, which strips your session cookie before relaying to the provider with a shared instance key.
- SQL generation is grounded on the warehouse catalog the sidecar assembles itself, so a modified client cannot make the model write SQL against tables that do not exist.
- The data chat reads the library under your own session, so it can only name queries and dashboards you can open. SQL generation profiles the table it is asked about on the service account, so the configured provider sees a sample of that table.
