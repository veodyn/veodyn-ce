import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { PublishFinding } from '@/types/published-feed'

// `normalize_report` flattens the validator's report to one finding per
// occurrence, so a single broken rule arrives as many rows sharing a ruleId.
// Listing them raw reads as many problems when it is one, so they group here
// and the free-text locators sit behind a disclosure.
interface Rule {
  ruleId: string
  severity: string
  title: string
  locators: string[]
}

export function groupByRule(findings: PublishFinding[]): Rule[] {
  const byRule = new Map<string, Rule>()
  for (const finding of findings) {
    const existing = byRule.get(finding.ruleId)
    if (existing) {
      if (finding.locator) existing.locators.push(finding.locator)
      continue
    }
    byRule.set(finding.ruleId, {
      ruleId: finding.ruleId,
      severity: finding.severity,
      title: finding.title,
      locators: finding.locator ? [finding.locator] : [],
    })
  }
  return [...byRule.values()]
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
                {rule.locators.length} {rule.locators.length === 1 ? 'occurrence' : 'occurrences'}
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
