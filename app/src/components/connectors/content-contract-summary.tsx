import type { ConnectorType } from '@/types/connector'

export function contentContractLines(connectorType: ConnectorType): string[] {
  const contract = connectorType.contentContract
  const lines: string[] = []
  if (contract.maxLength !== null) {
    lines.push(`A rendering may run to ${contract.maxLength} characters.`)
  }
  lines.push(
    contract.supportsMarkup
      ? 'This channel accepts markup.'
      : 'This channel takes plain text, so a rendering carrying markup is refused.'
  )
  if (contract.urlCountsAsCharacters !== null) {
    lines.push(`Every link counts as ${contract.urlCountsAsCharacters} characters, whatever its real length.`)
  }
  if (contract.requiredFooter !== null) {
    lines.push(`Every rendering must end with "${contract.requiredFooter}".`)
  }
  lines.push(
    connectorType.recallable
      ? 'A message published here can be recalled.'
      : 'A message published here cannot be recalled, so a correction goes out as a follow-up.'
  )
  return lines
}

export function ContentContractSummary({ connectorType }: { connectorType: ConnectorType }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="text-sm font-medium">What {connectorType.displayName} accepts</h4>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {contentContractLines(connectorType).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}
