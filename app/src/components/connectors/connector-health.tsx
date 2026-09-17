import { Badge } from '@/components/ui/badge'
import type { ConnectorHealth } from '@/types/connector'

const LABEL: Record<ConnectorHealth['delivery'], string> = {
  untested: 'Untested',
  delivering: 'Delivering',
  failing: 'Failing',
}

const VARIANT: Record<ConnectorHealth['delivery'], 'outline' | 'secondary' | 'destructive'> = {
  untested: 'outline',
  delivering: 'secondary',
  failing: 'destructive',
}

export function connectorHealthSentence(health: ConnectorHealth): string {
  if (health.delivery === 'untested') {
    return 'Credentials accepted. Nothing has been delivered through this connector yet, so its channel is untested.'
  }
  const detail = health.lastDeliveryDetail ?? 'no detail recorded'
  return health.delivery === 'delivering'
    ? `Last delivery succeeded: ${detail}.`
    : `Last delivery failed: ${detail}.`
}

export function ConnectorHealthBadge({ health }: { health: ConnectorHealth }) {
  return <Badge variant={VARIANT[health.delivery]}>{LABEL[health.delivery]}</Badge>
}
