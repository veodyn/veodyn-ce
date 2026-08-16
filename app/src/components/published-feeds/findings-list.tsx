import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { PublishFinding } from '@/types/published-feed'

// `normalize_report` flattens the validator's report to one finding per
// EXPORTED occurrence, so a single broken rule arrives as several rows sharing
// a ruleId. Listing them raw reads as many problems when it is one, so they
// group here and the free-text locators sit behind a disclosure.
//
// The validator caps how many occurrences it exports per rule (1000 in 0.2.0)
// while reporting the true total separately, so below that ceiling the two
// agree and above it the rows are a sample. Showing the sample size alone
// would tell an operator a thousand vehicles are broken when four thousand
// are, which is worse than vague because it looks exact.
interface Rule {
  ruleId: string
  severity: string
  title: string
  locators: string[]
  /** The validator's own total. Zero means the attempt predates the field. */
  occurrenceCount: number
}

export function groupByRule(findings: PublishFinding[]): Rule[] {
  const byRule = new Map<string, Rule>()
  for (const finding of findings) {
    const existing = byRule.get(finding.ruleId)
    if (existing) {
      if (finding.locator) existing.locators.push(finding.locator)
      // Every finding from one notice repeats that notice's total, so the
      // first one already carried it. Taking the max rather than trusting that
      // costs nothing and keeps this honest if two notices ever share a rule.
      existing.occurrenceCount = Math.max(existing.occurrenceCount, finding.occurrenceCount)
      continue
    }
    byRule.set(finding.ruleId, {
      ruleId: finding.ruleId,
      severity: finding.severity,
      title: finding.title,
      locators: finding.locator ? [finding.locator] : [],
      occurrenceCount: finding.occurrenceCount,
    })
  }
  return [...byRule.values()]
}

/**
 * What the disclosure says, which is the whole point of carrying the count.
 *
 * Falls back to the number of locators when the count is absent, which is what
 * an attempt recorded before the field existed looks like. A stored zero is
 * "unknown", never "none": a finding exists, so at least one thing happened.
 */
export function occurrenceLabel(shown: number, total: number): string {
  if (total > shown) return `showing ${shown} of ${total} occurrences`
  const counted = total > 0 ? total : shown
  return `${counted} ${counted === 1 ? 'occurrence' : 'occurrences'}`
}

export function FindingsList({ findings }: { findings: PublishFinding[] }) {
  const rules = groupByRule(findings)
  if (rules.length === 0) return null
  return (
    <ul className="space-y-2">
      {rules.map((rule) => (
        <li key={rule.ruleId} className="rounded-md border p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{rule.title}</span>
            <span className="font-mono text-xs text-muted-foreground">{rule.ruleId}</span>
          </div>
          {rule.locators.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="mt-1 text-xs text-muted-foreground hover:text-foreground">
                {occurrenceLabel(rule.locators.length, rule.occurrenceCount)}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-1 space-y-0.5">
                  {rule.locators.map((locator, index) => (
                    <li key={`${rule.ruleId}-${index}`} className="font-mono text-xs text-muted-foreground">
                      {locator}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}
        </li>
      ))}
    </ul>
  )
}
