import type { MockDestinationType } from '../types/destination-types'

export const mockDestinationTypes: MockDestinationType[] = [
  {
    type: 'email',
    name: 'Email',
    configuration_schema: {
      type: 'object',
      properties: {
        addresses: { type: 'string', title: 'Email Addresses (comma-separated)' },
      },
      required: ['addresses'],
      secret: [],
    },
    icon: 'fa-envelope',
  },
  {
    type: 'slack',
    name: 'Slack',
    configuration_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', title: 'Slack Webhook URL' },
        channel: { type: 'string', title: 'Channel', default: '' },
        username: { type: 'string', title: 'Username', default: 'Veodyn' },
        icon_emoji: { type: 'string', title: 'Icon Emoji', default: ':bar_chart:' },
      },
      required: ['url'],
      secret: ['url'],
    },
    icon: 'fa-slack',
  },
  {
    type: 'webhook',
    name: 'Webhook',
    configuration_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', title: 'URL' },
        username: { type: 'string', title: 'Username (HTTP Basic Auth)' },
        password: { type: 'string', title: 'Password (HTTP Basic Auth)' },
      },
      required: ['url'],
      secret: ['password'],
    },
    icon: 'fa-bolt',
  },
]
