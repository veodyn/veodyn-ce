/**
 * A button whose whole label is a line of text sitting in a row of read-only
 * text: the schedule phrase in a query header, the cadence in a Schedules row.
 *
 * It has to read as the text around it and still say it can be clicked, so the
 * affordance is the one EditInPlace already uses for editable text: a rule that
 * appears under it on hover, plus the colour lifting to `foreground`. Shared as
 * a constant rather than copied, because two surfaces that hint at editability
 * differently teach the reader that only one of them is editable.
 *
 * `py-1 -my-1` grows the hit target without moving anything: at the inherited
 * line height these controls were under the 24px minimum target size, and the
 * negative margin hands the padding back to the layout. The rest neutralises
 * Button's own chrome (weight, background, click shift).
 */
export const INLINE_TEXT_CONTROL =
  'h-auto rounded-sm border-b border-transparent px-0 py-1 -my-1 font-normal text-muted-foreground hover:border-muted-foreground/30 hover:bg-transparent hover:text-foreground active:translate-y-0 dark:hover:bg-transparent'
