import type { MockDestination } from '../types/destinations'

export const mockDestinations: MockDestination[] = [
  {
    id: 1,
    name: 'Team Email',
    type: 'email',
    options: { addresses: 'team@example.com,alerts@example.com' },
    created_at: '2024-06-01T10:00:00Z',
  },
  {
    id: 2,
    name: 'Ops Slack',
    type: 'slack',
    options: {
      url: 'https://hooks.slack.com/services/mock/webhook/url',
      channel: '#ops-alerts',
      username: 'Veodyn Alerts',
      icon_emoji: ':bar_chart:',
    },
    created_at: '2024-09-15T14:00:00Z',
  },
]
