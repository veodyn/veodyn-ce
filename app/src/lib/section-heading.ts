/**
 * The two heading levels below a page title.
 *
 * There were five treatments in the app when this was written, picked per
 * screen: `font-display text-lg` on the catalog and report-edit pages,
 * `font-display text-base` on the KPI scorecard, `text-sm font-semibold` in
 * eleven cards, `text-sm font-medium` in six more, and Settings alone at
 * `text-lg`. The same rung of the hierarchy therefore looked like a different
 * rung depending on which route you had reached it from.
 *
 * Two levels, chosen by CONTAINER rather than by importance, because that is
 * the distinction a reader actually sees:
 *
 * - `SECTION_HEADING`     a section of the page itself, sitting on the page
 *                         background ("Datasets", "Schema", "Recent Queries").
 * - `SUBSECTION_HEADING`  a heading inside a card or panel that already has a
 *                         border around it ("Security", "Groups", "General").
 *
 * The page title above both is PageHeader's, and is not restated here.
 *
 * Report document body headings deliberately do NOT use these. A report is
 * authored prose with its own heading scale, the way a markdown document has
 * one; it is content, not app chrome, and it renders identically in the print
 * and public views where none of this chrome exists.
 */
export const SECTION_HEADING = 'font-display text-lg font-medium'

export const SUBSECTION_HEADING = 'text-sm font-semibold'

/**
 * The uppercase Geist Mono micro-labels that tag a strip of data rather than
 * open a section ("NOTABLE CHANGES", "MOVERS", "YOUR QUERIES").
 *
 * These used to be exempt from this file on the grounds that they were
 * "consistent with each other already". They were not quite: the string was
 * hand-copied into six files, and it carried `font-medium` in five places and
 * omitted it in three, so the weight came from whichever element it landed on.
 * That difference is not noise, though, which is why this is two constants and
 * not one: NotableChangesStrip renders MICRO_LABEL on the strip's own <h2> and
 * MICRO_SUBLABEL on the <h3>s nested inside it, thirty lines apart, and the
 * weight is the only thing distinguishing the two rungs. Flattening them would
 * have lost a real hierarchy in the name of tidiness.
 *
 * Callers add their own margin: these sit above a table on one screen and above
 * a card grid on another, and those want different gaps.
 */
export const MICRO_LABEL = 'font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground'

export const MICRO_SUBLABEL = 'font-mono text-xs uppercase tracking-wider text-muted-foreground'
