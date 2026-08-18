/**
 * The two heading levels below a page title, chosen by CONTAINER:
 *
 * - `SECTION_HEADING`     a section on the page background ("Datasets").
 * - `SUBSECTION_HEADING`  a heading inside a card or panel ("Security").
 *
 * The page title above both is PageHeader's. Report document body headings do
 * not use these: a report is authored prose with its own heading scale.
 */
export const SECTION_HEADING = 'font-display text-lg font-medium'

export const SUBSECTION_HEADING = 'text-sm font-semibold'

/**
 * The uppercase Geist Mono micro-labels that tag a strip of data rather than
 * open a section ("NOTABLE CHANGES", "MOVERS", "YOUR QUERIES").
 *
 * Two constants, not one: NotableChangesStrip puts MICRO_LABEL on the strip's
 * <h2> and MICRO_SUBLABEL on the <h3>s nested inside it, and the weight is the
 * only thing separating the two rungs.
 *
 * Callers add their own margin.
 */
export const MICRO_LABEL = 'font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground'

export const MICRO_SUBLABEL = 'font-mono text-xs uppercase tracking-wider text-muted-foreground'
