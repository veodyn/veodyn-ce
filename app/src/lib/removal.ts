/**
 * What it means to remove each kind of Library content, and the words used to
 * ask about it.
 *
 * The two backends disagree about removal and neither is wrong. Redash archives
 * queries and dashboards recoverably; veodyn-api deletes KPIs and reports
 * outright and Redash deletes snippets outright. Rather than hide that behind
 * one verb, each type says what actually happens, and it says it from here so
 * the list row and the detail page cannot drift apart.
 */

/**
 * The five things in the Library sidebar group (`lib/sidebar-nav.ts`).
 *
 * Deliberately not `CreateKind` from `types/ai-create.ts`, which happens to
 * hold the same five strings: that union is half of a wire contract mirrored in
 * `veodyn_api/schemas/ai.py`, and removal copy must not move when the AI
 * conversation contract does.
 */
export type LibraryKind = 'query' | 'dashboard' | 'kpi' | 'report' | 'snippet'

/** Recoverable, or not. Drives the verb and whether a Restore path is offered. */
export type RemovalSemantic = 'archive' | 'delete'

interface RemovalDescriptor {
  semantic: RemovalSemantic
  /** Lower-case singular, for the case where there is no name to quote. */
  noun: string
  /** What is lost, in the words a person would use for it. */
  consequence: string
}

const REMOVAL: Record<LibraryKind, RemovalDescriptor> = {
  // Archiving a query is not the tidy-up its label suggests. Query.archive
  // (node/redash/models/__init__.py:491-505) clears the schedule, deletes
  // every alert on the query, and deletes every widget built on every one of
  // its visualizations. Unarchiving only clears is_archived, so it brings back
  // none of the three. This fired on a single unconfirmed click before and said
  // nothing about any of it, which is the whole reason this module exists.
  //
  // The schedule is named separately from the alerts and widgets because losing
  // it is silent: a restored query looks entirely intact and simply stops
  // running, which is the kind of thing noticed a week later by a stale number
  // on a dashboard.
  query: {
    semantic: 'archive',
    noun: 'query',
    consequence:
      'Its alerts, its refresh schedule and any dashboard widgets built on it will be removed, and those do not come back. The query itself can be restored from the Archive tab.',
  },
  dashboard: {
    semantic: 'archive',
    noun: 'dashboard',
    consequence:
      'It leaves your dashboards and any public link to it stops working. You can restore it from the Archive tab.',
  },
  // The query is named because it is the half that stays. A KPI created through
  // "Create KPI + query" writes a query and deleting the KPI removes only the
  // KPI, so the query it wrote is left in the library under the KPI's own name
  // with nothing pointing at it. Said here rather than silently orphaned: the
  // alternative is archiving a query this KPI may not be the only reader of.
  kpi: {
    semantic: 'delete',
    noun: 'KPI',
    consequence:
      'This removes the KPI along with its target, thresholds and history. The query it reads is not removed and stays in your queries. It cannot be undone.',
  },
  report: {
    semantic: 'delete',
    noun: 'report',
    consequence:
      'This removes the report and every block in it, for everyone. Any public link to it stops working. It cannot be undone.',
  },
  snippet: {
    semantic: 'delete',
    noun: 'snippet',
    consequence: 'This removes the snippet for everyone in the organization. It cannot be undone.',
  },
}

export interface RemovalCopy {
  /** "Archive" or "Delete". Also the menu item label and the confirm button. */
  verb: string
  title: string
  description: string
}

/**
 * Confirmation copy for removing one object.
 *
 * `name` is quoted when there is one. It can be absent for the moment between a
 * dialog closing and its pending item clearing, where a title built from a null
 * name would read "Delete ""?".
 */
export function removalCopy(kind: LibraryKind, name: string | null | undefined): RemovalCopy {
  const descriptor = REMOVAL[kind]
  const verb = descriptor.semantic === 'archive' ? 'Archive' : 'Delete'
  return {
    verb,
    title: name ? `${verb} "${name}"?` : `${verb} ${descriptor.noun}?`,
    description: descriptor.consequence,
  }
}

/** Whether removing this kind can be walked back, which is what earns a Restore path. */
export function isRecoverable(kind: LibraryKind): boolean {
  return REMOVAL[kind].semantic === 'archive'
}
